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
    const raw = await this.getText(url, ttlSeconds, tag);
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

  private async getText(url: string, ttlSeconds: number, tag: string): Promise<string> {
    const key = new Request(url, { method: 'GET' });
    const cache = this.options.cache;
    if (cache) {
      const hit = await cache.match(key).catch(() => undefined);
      if (hit) return hit.text();
    }
    const response = await this.fetchWithTimeout(url, tag);
    const body = await response.text();
    if (response.status === 404) throw new UpstreamError('not_found', errorText(body) ?? 'Introuvable.', `${tag}: 404`);
    if (response.status === 429) throw new UpstreamError('rate_limited', 'La source de données est très sollicitée. Réessayez dans une minute.', `${tag}: 429`);
    if (!response.ok) throw new UpstreamError('unavailable', 'La source de données ne répond pas pour le moment.', `${tag}: ${response.status}`);
    if (cache) {
      const stored = new Response(body, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttlSeconds}` },
      });
      const write = cache.put(key, stored).catch(() => undefined);
      if (this.options.waitUntil) this.options.waitUntil(write);
      else await write;
    }
    return body;
  }

  private async fetchWithTimeout(url: string, tag: string): Promise<Response> {
    const timeout = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await this.options.fetcher.fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': this.options.userAgent ?? USER_AGENT },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new UpstreamError('timeout', 'La source de données met trop de temps à répondre.', `${tag}: timeout`);
      throw new UpstreamError('unavailable', 'La source de données ne répond pas pour le moment.', `${tag}: ${error instanceof Error ? error.name : 'fetch failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function errorText(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}
