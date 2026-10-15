/** The Workers rate limiting binding, as far as we use it. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Fallback when the binding is absent: a fixed one-minute window per client,
 * per isolate. Approximate (each isolate counts alone) but bounded in memory.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 5_000,
  ) {}

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const t = this.now();
    const windowStart = t - (t % 60_000);
    const current = this.hits.get(key);
    const count = current && current.windowStart === windowStart ? current.count + 1 : 1;
    if (!current && this.hits.size >= this.maxKeys) this.sweep(windowStart);
    this.hits.set(key, { windowStart, count });
    return { success: count <= this.perMinute };
  }

  private sweep(windowStart: number): void {
    for (const [k, v] of this.hits) if (v.windowStart !== windowStart) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

/**
 * A limiter key never stores the identifier itself: a truncated SHA-256 digest of
 * scope, optional secret salt and value. Without the salt, a short public identifier
 * (an IPv4 address) could be recovered by brute force; with it, it cannot.
 */
export async function hashKey(scope: string, value: string, salt = ''): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bredouille-mcp:${scope}:${salt}:${value}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The key for a client address. */
export function clientKey(address: string, salt = ''): Promise<string> {
  return hashKey('ip', address, salt);
}

/** A positive integer from a `[vars]` string, or the default. */
export function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
