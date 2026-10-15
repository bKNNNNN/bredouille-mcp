import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createDataSource, type DataSource } from './bredouille';
import { DailyCounter, DEFAULT_FLUSH_EVERY, secondsToUtcMidnight, type CounterStore } from './daily-cap';
import { isMetered, parseMessages, userIdentifier, type RpcMessage } from './identity';
import { clientKey, hashKey, MemoryRateLimiter, positiveInt, type RateLimiter } from './rate-limit';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server';
import { SAFETY_LINE } from './text';
import { withFooter } from './tools/common';
import { Http, type Fetcher } from './upstream';

export interface Env {
  readonly BREDOUILLE_API_URL?: string;
  readonly SITE_URL?: string;
  /** Tool calls and resource reads per minute and end user (host-provided identifier). */
  readonly RATE_LIMIT_USER_PER_MINUTE?: string;
  /** MCP requests per minute and client address. */
  readonly RATE_LIMIT_IP_PER_MINUTE?: string;
  /** Worker requests per UTC day before tool calls are turned away; 0 disables. */
  readonly DAILY_CAP?: string;
  /** Requests between two syncs of an isolate's daily count to `DAILY_COUNTER`. */
  readonly DAILY_CAP_FLUSH_EVERY?: string;
  /** Optional secret salt for the hashed limiter keys (`wrangler secret put RATE_LIMIT_SALT`). */
  readonly RATE_LIMIT_SALT?: string;
  readonly WIDGET_DOMAIN?: string;
  /** Token for ChatGPT's MCP domain verification, served at /.well-known/openai-apps-challenge. */
  readonly OPENAI_APPS_CHALLENGE?: string;
  readonly MCP_USER_LIMITER?: RateLimiter;
  readonly MCP_IP_LIMITER?: RateLimiter;
  /** Optional KV namespace shared by isolates for the daily count. */
  readonly DAILY_COUNTER?: CounterStore;
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

export const DEFAULT_USER_PER_MINUTE = 30;
export const DEFAULT_IP_PER_MINUTE = 600;
export const DEFAULT_DAILY_CAP = 40_000;

export const DAILY_CAP_MESSAGE = 'Bredouille reçoit beaucoup de demandes aujourd’hui. Réessayez demain, ou consultez';
const USER_LIMIT_MESSAGE = 'Trop de demandes en peu de temps. Réessayez dans une minute.';

/** Per-isolate fallbacks when a binding is absent, one per configured rate. */
const fallbackLimiters = new Map<string, MemoryRateLimiter>();

function limiterFor(binding: RateLimiter | undefined, name: string, perMinute: number): RateLimiter {
  if (binding) return binding;
  const id = `${name}:${perMinute}`;
  let limiter = fallbackLimiters.get(id);
  if (!limiter) {
    limiter = new MemoryRateLimiter(perMinute);
    fallbackLimiters.set(id, limiter);
  }
  return limiter;
}

let isolateCounter: DailyCounter | null = null;

export interface Deps {
  readonly data?: DataSource;
  readonly now?: () => Date;
  /** The daily request counter; one per isolate by default. */
  readonly counter?: DailyCounter;
}

function counterFor(env: Env, deps: Deps): DailyCounter {
  if (deps.counter) return deps.counter;
  isolateCounter ??= new DailyCounter(undefined, positiveInt(env.DAILY_CAP_FLUSH_EVERY, DEFAULT_FLUSH_EVERY));
  return isolateCounter;
}

/** `DAILY_CAP` as a whole number; 0 disables the cap. */
function dailyCap(env: Env): number {
  const n = Number(env.DAILY_CAP ?? DEFAULT_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

const toolError = (id: unknown, text: string): Response =>
  json(200, { jsonrpc: '2.0', id: id ?? null, result: { content: [{ type: 'text', text }], isError: true } });

/**
 * Turns away a metered request: a single tools/call gets a tool error (HTTP 200) that the
 * host shows to the model; anything else gets HTTP 429 with a JSON-RPC error.
 */
function refuse(messages: readonly RpcMessage[], text: string, retryAfter: number): Response {
  const only = messages.length === 1 ? messages[0] : undefined;
  if (only?.method === 'tools/call') return toolError(only.id, text);
  return rpcError(429, -32000, text, { 'retry-after': String(retryAfter) });
}

/** Per-user limit on tool calls and resource reads that carry a host user identifier. */
async function userLimited(messages: readonly RpcMessage[], headers: Headers, env: Env): Promise<boolean> {
  const limiter = limiterFor(env.MCP_USER_LIMITER, 'user', positiveInt(env.RATE_LIMIT_USER_PER_MINUTE, DEFAULT_USER_PER_MINUTE));
  for (const m of messages) {
    if (!isMetered(m)) continue;
    const id = userIdentifier(m, headers);
    // No identifier: the per-IP limit, already applied, is the only one.
    if (!id) continue;
    const { success } = await limiter.limit({ key: await hashKey(id.kind, id.value, env.RATE_LIMIT_SALT) });
    if (!success) return true;
  }
  return false;
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

/** The body, read with a byte counter so a chunked upload cannot exceed the cap; null when it does. */
async function readBody(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel();
      return null;
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

/**
 * Argument validation errors are written by the SDK, before our handlers run.
 * They get the same safety line and link as every other tool answer.
 */
async function footerOnErrors(response: Response, siteUrl: string): Promise<Response> {
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response;
  const text = await response.text();
  let changed = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(text, response);
  }
  const fix = (msg: unknown): unknown => {
    const m = msg as { result?: { isError?: boolean; content?: { type: string; text?: string }[] } };
    const first = m?.result?.content?.[0];
    if (m?.result?.isError && first?.type === 'text' && typeof first.text === 'string' && !first.text.includes(SAFETY_LINE)) {
      first.text = withFooter(`Paramètres invalides. ${first.text}`, `${siteUrl}/#carte`);
      changed = true;
    }
    return m;
  };
  const out = Array.isArray(parsed) ? parsed.map(fix) : fix(parsed);
  if (!changed) return new Response(text, response);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(out), { status: response.status, headers });
}

async function handleMcp(request: Request, env: Env, ctx: ExecutionContext, deps: Deps, overCap: boolean): Promise<Response> {
  if (request.method === 'OPTIONS') return withHeaders(new Response(null, { status: 204 }), CORS_HEADERS);
  if (request.method !== 'POST') return rpcError(405, -32000, 'Méthode non autorisée : ce serveur est sans état, utilisez POST.', { allow: 'POST, OPTIONS' });

  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return rpcError(413, -32600, 'Requête trop volumineuse.');

  const address = request.headers.get('cf-connecting-ip') ?? 'local';
  const ipLimiter = limiterFor(env.MCP_IP_LIMITER, 'ip', positiveInt(env.RATE_LIMIT_IP_PER_MINUTE, DEFAULT_IP_PER_MINUTE));
  const allowed = await ipLimiter.limit({ key: await clientKey(address, env.RATE_LIMIT_SALT) });
  if (!allowed.success) return rpcError(429, -32000, 'Trop de requêtes. Réessayez dans une minute.', { 'retry-after': '60' });

  const body = await readBody(request, MAX_BODY_BYTES);
  if (body === null) return rpcError(413, -32600, 'Requête trop volumineuse.');

  const siteUrl = (env.SITE_URL ?? DEFAULT_SITE).replace(/\/+$/, '');
  const messages = parseMessages(body);
  // Over the daily cap, only tool calls are turned away: they are what reaches the
  // Bredouille API. initialize and the lists still answer, so the host can relay the message.
  if (overCap && messages.some((m) => m.method === 'tools/call')) {
    const text = withFooter(`${DAILY_CAP_MESSAGE} ${siteUrl}.`, siteUrl);
    return refuse(messages, text, secondsToUtcMidnight((deps.now ?? (() => new Date()))()));
  }
  if (await userLimited(messages, request.headers, env)) return refuse(messages, withFooter(USER_LIMIT_MESSAGE, siteUrl), 60);

  const forward = new Request(request.url, { method: 'POST', headers: request.headers, body });
  const server = createMcpServer(
    { data: deps.data ?? defaultData(env, ctx), siteUrl, now: deps.now ?? (() => new Date()) },
    { widgetDomain: env.WIDGET_DOMAIN },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(forward);
    return withHeaders(await footerOnErrors(response, siteUrl), CORS_HEADERS);
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
      const now = (deps.now ?? (() => new Date()))();
      const { over, sync } = counterFor(env, deps).hit(now, dailyCap(env), env.DAILY_COUNTER);
      if (sync) ctx.waitUntil(sync);
      if (pathname === '/mcp' || pathname === '/mcp/') return handleMcp(request, env, ctx, deps, over);
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Méthode non autorisée' }, { allow: 'GET, HEAD' });
      if (pathname === '/.well-known/openai-apps-challenge') {
        const token = env.OPENAI_APPS_CHALLENGE?.trim();
        return token ? new Response(token, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : json(404, { error: 'Introuvable' });
      }
      if (pathname === '/health') return json(200, { ok: true, name: SERVER_NAME, version: SERVER_VERSION });
      if (over) {
        const site = (env.SITE_URL ?? DEFAULT_SITE).replace(/\/+$/, '');
        return json(429, { error: `${DAILY_CAP_MESSAGE} ${site}.` }, { 'retry-after': String(secondsToUtcMidnight(now)) });
      }
      if (pathname === '/') return withHeaders(new Response(HOME, { headers: { 'content-type': 'text/plain; charset=utf-8' } }), {});
      return json(404, { error: 'Introuvable' });
    },
  } satisfies ExportedHandler<Env>;
}
