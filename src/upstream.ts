import type { ZodType } from 'zod';

/** Why an upstream call gave nothing usable. `message` is safe to show (French, no coordinates). */
export type UpstreamFailure = 'not_found' | 'unavailable' | 'timeout' | 'rate_limited' | 'invalid';

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamFailure,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface HttpOptions {
  /** Plain fetch, or a service binding for the Bredouille API. */
  readonly fetcher: Fetcher;
  /** Cache API (caches.default) on Workers; absent in tests. */
  readonly cache?: EdgeCache | undefined;
  /** Lets cache writes finish after the answer (ctx.waitUntil). */
  readonly waitUntil?: ((p: Promise<unknown>) => void) | undefined;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

export const DEFAULT_TIMEOUT_MS = 6_000;
export const USER_AGENT = 'bredouille-mcp/0.1 (+https://bredouille.app; contact@bredouille.app)';

/** One JSON GET with a timeout, the edge cache in front, and a schema check behind. */
export class Http {
  constructor(private readonly options: HttpOptions) {}

  async getJson<T>(url: string, schema: ZodType<T>, ttlSeconds: number, tag: string): Promise<T> {
    const key = new Request(url, { method: 'GET' });
    const memo = this.memoGet(url);
    if (memo !== undefined) return this.parse(memo, schema, tag);
    const cache = this.options.cache;
    if (cache) {
      const hit = await cache.match(key).catch(() => undefined);
      if (hit) {
        const text = await hit.text();
        this.memoSet(url, text, ttlSeconds);
        return this.parse(text, schema, tag);
      }
    }
    const body = await this.fetchBody(url, tag);
    // Validate before caching: a broken answer must never stay in the cache.
    const value = this.parse(body, schema, tag);
    this.memoSet(url, body, ttlSeconds);
    if (cache) {
      const stored = new Response(body, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttlSeconds}` },
      });
      const write = cache.put(key, stored).catch(() => undefined);
      if (this.options.waitUntil) this.options.waitUntil(write);
      else await write;
    }
    return value;
  }

  private parse<T>(raw: string, schema: ZodType<T>, tag: string): T {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new UpstreamError('invalid', 'Réponse illisible de la source de données.', `${tag}: not JSON`);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new UpstreamError('invalid', 'Réponse inattendue de la source de données.', `${tag}: ${parsed.error.issues[0]?.path.join('.') ?? 'root'}`);
    }
    return parsed.data;
  }

  /**
   * In-isolate copy of recent answers. The Cache API does nothing on *.workers.dev,
   * so this keeps repeat questions off the upstreams until the custom domain is live.
   */
  private memoGet(url: string): string | undefined {
    const hit = MEMO.get(url);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      MEMO.delete(url);
      return undefined;
    }
    return hit.body;
  }

  private memoSet(url: string, body: string, ttlSeconds: number): void {
    if (body.length > MEMO_MAX_ENTRY) return;
    if (MEMO.size >= MEMO_MAX_KEYS) MEMO.delete(MEMO.keys().next().value as string);
    MEMO.set(url, { body, expires: Date.now() + ttlSeconds * 1000 });
  }

  /** Fetch and read the body under one timeout, with a size cap. Upstream error text is never shown. */
  private async fetchBody(url: string, tag: string): Promise<string> {
    const timeout = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.options.fetcher.fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': this.options.userAgent ?? USER_AGENT },
        signal: controller.signal,
      });
      if (response.status === 404) {
        void response.body?.cancel();
        throw new UpstreamError('not_found', 'Rien trouvé pour cette demande.', `${tag}: 404`);
      }
      if (response.status === 429) {
        void response.body?.cancel();
        throw new UpstreamError('rate_limited', 'La source de données est très sollicitée. Réessayez dans une minute.', `${tag}: 429`);
      }
      if (!response.ok) {
        void response.body?.cancel();
        throw new UpstreamError('unavailable', 'La source de données ne répond pas pour le moment.', `${tag}: ${response.status}`);
      }
      return await readCapped(response, MAX_UPSTREAM_BYTES, tag);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (controller.signal.aborted) throw new UpstreamError('timeout', 'La source de données met trop de temps à répondre.', `${tag}: timeout`);
      throw new UpstreamError('unavailable', 'La source de données ne répond pas pour le moment.', `${tag}: ${error instanceof Error ? error.name : 'fetch failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Largest upstream body accepted (accuracy.json is about 260 KB). */
export const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const MEMO_MAX_KEYS = 200;
const MEMO_MAX_ENTRY = 512 * 1024;
const MEMO = new Map<string, { body: string; expires: number }>();

/** Test hook: forget the in-isolate copies. */
export function clearMemo(): void {
  MEMO.clear();
}

async function readCapped(response: Response, max: number, tag: string): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > max) {
    void response.body?.cancel();
    throw new UpstreamError('invalid', 'Réponse trop volumineuse de la source de données.', `${tag}: too large`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel();
      throw new UpstreamError('invalid', 'Réponse trop volumineuse de la source de données.', `${tag}: too large`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
