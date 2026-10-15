/**
 * Approximate count of Worker requests per UTC day, against `DAILY_CAP`.
 *
 * Each isolate counts its own requests in memory. With the optional `DAILY_COUNTER`
 * KV binding, every `flushEvery` requests an isolate writes its own running total under
 * `<day>:<isolate id>` (count in the key's metadata), then lists `<day>:` to learn the
 * totals of the other isolates. Each key has a single writer, so no increment is lost to
 * a write race; the count is still approximate:
 *
 * - an isolate's last unflushed requests (fewer than `flushEvery`) are not seen by others;
 * - KV listings can lag writes by up to about a minute;
 * - an isolate evicted mid-day keeps its last flushed total in KV, which is what we want.
 *
 * So the estimate can trail the real count by about `flushEvery` per live isolate, and the
 * cap acts a little late, never early. Without the binding, each isolate only knows its own
 * count. Keys expire after two days.
 */

export interface CounterStore {
  put(key: string, value: string, options: { expirationTtl: number; metadata: { n: number } }): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export const DEFAULT_FLUSH_EVERY = 100;
const TTL_SECONDS = 2 * 24 * 3600;
const MAX_LIST_PAGES = 20;

export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/** Seconds until the next UTC midnight, for `retry-after`. */
export function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function countOf(metadata: unknown): number {
  const n = (metadata as { n?: unknown } | undefined)?.n;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export interface Hit {
  /** True once the estimated count for the day is over the cap. */
  readonly over: boolean;
  /** A KV sync to hand to `ctx.waitUntil`, when one is due. */
  readonly sync: Promise<void> | null;
}

export class DailyCounter {
  private day = '';
  private own = 0;
  private flushed = 0;
  private others = 0;
  private syncing = false;

  constructor(
    private readonly isolateId: string = crypto.randomUUID(),
    private readonly flushEvery: number = DEFAULT_FLUSH_EVERY,
  ) {}

  /** Counts one request. `cap` <= 0 disables the cap (requests are still counted). */
  hit(now: Date, cap: number, store?: CounterStore): Hit {
    const day = utcDay(now);
    if (day !== this.day) {
      this.day = day;
      this.own = 0;
      this.flushed = 0;
      this.others = 0;
    }
    this.own += 1;
    const over = cap > 0 && this.estimate() > cap;
    const due = store !== undefined && !this.syncing && this.own - this.flushed >= this.flushEvery;
    return { over, sync: due ? this.sync(store, day) : null };
  }

  estimate(): number {
    return this.own + this.others;
  }

  private async sync(store: CounterStore, day: string): Promise<void> {
    this.syncing = true;
    const own = this.own;
    const mine = `${day}:${this.isolateId}`;
    try {
      await store.put(mine, '', { expirationTtl: TTL_SECONDS, metadata: { n: own } });
      if (this.day === day) this.flushed = Math.max(this.flushed, own);
      let others = 0;
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const res = await store.list({ prefix: `${day}:`, cursor });
        for (const k of res.keys) if (k.name !== mine) others += countOf(k.metadata);
        if (res.list_complete || !res.cursor) break;
        cursor = res.cursor;
      }
      if (this.day === day) this.others = others;
    } catch (error) {
      console.warn('[daily-cap]', error instanceof Error ? error.name : 'unknown');
    } finally {
      this.syncing = false;
    }
  }
}
