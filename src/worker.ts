import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createDataSource, type DataSource } from './bredouille';
import { clientKey, MemoryRateLimiter, type RateLimiter } from './rate-limit';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server';
import { Http, type Fetcher } from './upstream';

export interface Env {
  readonly BREDOUILLE_API_URL?: string;
  readonly SITE_URL?: string;
  readonly RATE_LIMIT_PER_MINUTE?: string;
  readonly WIDGET_DOMAIN?: string;
  /** Token for ChatGPT's MCP domain verification, served at /.well-known/openai-apps-challenge. */
  readonly OPENAI_APPS_CHALLENGE?: string;
  readonly MCP_LIMITER?: RateLimiter;
  /** Optional service binding to the bredouille-api Worker. */
  readonly BREDOUILLE_API?: Fetcher;
}

export const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_API = 'https://api.bredouille.app';
const DEFAULT_SITE = 'https://bredouille.app';

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400',
};

function withHeaders(response: Response, extra: Readonly<Record<string, string>>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  withHeaders(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }), { ...CORS_HEADERS, ...extra });

const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}): Response =>
  json(status, { jsonrpc: '2.0', error: { code, message }, id: null }, extra);

let fallbackLimiter: MemoryRateLimiter | null = null;

function limiterFor(env: Env): RateLimiter {
  if (env.MCP_LIMITER) return env.MCP_LIMITER;
  const perMinute = Number(env.RATE_LIMIT_PER_MINUTE ?? '30');
  fallbackLimiter ??= new MemoryRateLimiter(Number.isFinite(perMinute) && perMinute > 0 ? perMinute : 30);
  return fallbackLimiter;
}

export interface Deps {
  readonly data?: DataSource;
  readonly now?: () => Date;
}

function defaultData(env: Env, ctx: ExecutionContext): DataSource {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
  const http = new Http({
    fetcher: env.BREDOUILLE_API ?? { fetch: (input, init) => fetch(input, init) },
    cache,
    waitUntil: (p) => ctx.waitUntil(p),
  });
  // Geo lookups never go through the service binding.
  const geoHttp = new Http({ fetcher: { fetch: (input, init) => fetch(input, init) }, cache, waitUntil: (p) => ctx.waitUntil(p) });
  const api = createDataSource(http, env.BREDOUILLE_API_URL ?? DEFAULT_API);
  const geo = createDataSource(geoHttp, env.BREDOUILLE_API_URL ?? DEFAULT_API);
  return { ...api, communesByName: geo.communesByName, communesByPostcode: geo.communesByPostcode, communeAt: geo.communeAt, communesOfDept: geo.communesOfDept };
}

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return withHeaders(new Response(null, { status: 204 }), CORS_HEADERS);
  if (request.method !== 'POST') return rpcError(405, -32000, 'Méthode non autorisée : ce serveur est sans état, utilisez POST.', { allow: 'POST, OPTIONS' });

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return rpcError(413, -32600, 'Requête trop volumineuse.');

  const address = request.headers.get('cf-connecting-ip') ?? 'local';
  const allowed = await limiterFor(env).limit({ key: await clientKey(address) });
  if (!allowed.success) return rpcError(429, -32000, 'Trop de requêtes. Réessayez dans une minute.', { 'retry-after': '60' });

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return rpcError(413, -32600, 'Requête trop volumineuse.');
  const forward = new Request(request.url, { method: 'POST', headers: request.headers, body });

  const server = createMcpServer(
    { data: deps.data ?? defaultData(env, ctx), siteUrl: (env.SITE_URL ?? DEFAULT_SITE).replace(/\/+$/, ''), now: deps.now ?? (() => new Date()) },
    { widgetDomain: env.WIDGET_DOMAIN },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(forward);
    return withHeaders(response, CORS_HEADERS);
  } finally {
    ctx.waitUntil(server.close().catch(() => undefined));
  }
}

const HOME = `Bredouille MCP ${SERVER_VERSION}

Serveur MCP distant de Bredouille, la carte des conditions de pousse des champignons en France.
Point d’entrée MCP (Streamable HTTP, sans état) : /mcp
Site : https://bredouille.app
Bredouille indique des conditions, pas des champignons. Faites contrôler toute cueillette.
`;

export function createWorker(deps: Deps = {}) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === '/mcp' || pathname === '/mcp/') return handleMcp(request, env, ctx, deps);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Méthode non autorisée' }, { allow: 'GET, HEAD' });
      if (pathname === '/.well-known/openai-apps-challenge') {
        const token = env.OPENAI_APPS_CHALLENGE?.trim();
        return token ? new Response(token, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : json(404, { error: 'Introuvable' });
      }
      if (pathname === '/health') return json(200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
      if (pathname === '/') return withHeaders(new Response(HOME, { headers: { 'content-type': 'text/plain; charset=utf-8' } }), {});
      return json(404, { error: 'Introuvable' });
    },
  } satisfies ExportedHandler<Env>;
}
