import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyCounter, secondsToUtcMidnight, type CounterStore } from '../src/daily-cap';
import { parseMessages, userIdentifier } from '../src/identity';
import { clientKey, hashKey, MemoryRateLimiter } from '../src/rate-limit';
import { SAFETY_LINE } from '../src/text';
import { createWorker, type Env } from '../src/worker';
import { NOW, testData } from './helpers';

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;

const call = (id: number, meta?: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'regles_et_chasse', arguments: { departement: '19' }, ...(meta ? { _meta: meta } : {}) },
});
const list = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });

function setup(env: Env = {}, counter = new DailyCounter('t')) {
  const worker = createWorker({ data: testData(), now: () => NOW, counter });
  const fullEnv: Env = { MCP_USER_LIMITER: new MemoryRateLimiter(2), MCP_IP_LIMITER: new MemoryRateLimiter(100), ...env };
  const rpc = (body: unknown, ip = '198.51.100.1', headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'cf-connecting-ip': ip, ...headers },
        body: JSON.stringify(body),
      }),
      fullEnv,
      ctx,
    );
  const get = (path: string) => worker.fetch(new Request(`https://mcp.test${path}`), fullEnv, ctx);
  return { rpc, get };
}

type ToolBody = { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
const textOf = async (res: Response) => ((await res.json()) as ToolBody).result?.content[0]?.text ?? '';

describe('user identifier extraction', () => {
  const none = new Headers();

  it('prefers openai/subject, then openai/session, then the Mcp-Session-Id header', () => {
    const both = call(1, { 'openai/subject': 'sub-1', 'openai/session': 'conv-1' });
    expect(userIdentifier(both, new Headers({ 'mcp-session-id': 'h-1' }))).toEqual({ kind: 'openai-subject', value: 'sub-1' });
    expect(userIdentifier(call(2, { 'openai/session': 'conv-1' }), none)).toEqual({ kind: 'openai-session', value: 'conv-1' });
    expect(userIdentifier(call(3), new Headers({ 'mcp-session-id': 'h-1' }))).toEqual({ kind: 'mcp-session', value: 'h-1' });
  });

  it('returns null without a usable identifier', () => {
    expect(userIdentifier(call(1), none)).toBeNull();
    expect(userIdentifier(call(2, { 'openai/subject': 42 }), none)).toBeNull();
    expect(userIdentifier(call(3, { 'openai/subject': '   ' }), none)).toBeNull();
    expect(userIdentifier(call(4, { 'openai/subject': 'x'.repeat(600) }), none)).toBeNull();
    expect(userIdentifier({ method: 'tools/call' }, none)).toBeNull();
  });

  it('parses single and batch bodies, and nothing from invalid JSON', () => {
    expect(parseMessages(JSON.stringify(call(1)))).toHaveLength(1);
    expect(parseMessages(JSON.stringify([call(1), list(2)]))).toHaveLength(2);
    expect(parseMessages('{nope')).toEqual([]);
    expect(parseMessages('42')).toEqual([]);
  });
});

describe('hashed keys', () => {
  it('never contain the identifier and change with the salt', async () => {
    const plain = await hashKey('openai-subject', 'user-abc');
    expect(plain).toMatch(/^[0-9a-f]{24}$/);
    expect(plain).not.toContain('abc');
    expect(await hashKey('openai-subject', 'user-abc', 'salt')).not.toBe(plain);
    expect(await hashKey('openai-session', 'user-abc')).not.toBe(plain);
    expect(await clientKey('203.0.113.7', 's')).not.toBe(await clientKey('203.0.113.7'));
  });
});

describe('per-user and per-IP limits', () => {
  it('limits tool calls per user, not per shared address', async () => {
    const { rpc } = setup();
    const alice = { 'openai/subject': 'alice' };
    expect(await textOf(await rpc(call(1, alice)))).toContain('Corrèze');
    expect(await textOf(await rpc(call(2, alice)))).toContain('Corrèze');
    const limited = await rpc(call(3, alice));
    expect(limited.status).toBe(200);
    const text = await textOf(limited);
    expect(text).toContain('Réessayez dans une minute');
    expect(text).toContain(SAFETY_LINE);
    // Another user behind the same egress address is unaffected.
    expect(await textOf(await rpc(call(4, { 'openai/subject': 'bob' })))).toContain('Corrèze');
  });

  it('does not count protocol messages against the user limit', async () => {
    const { rpc } = setup();
    for (let i = 0; i < 5; i++) expect((await rpc(list(i))).status).toBe(200);
    expect(await textOf(await rpc(call(9, { 'openai/subject': 'alice' })))).toContain('Corrèze');
  });

  it('falls back to the per-IP limit alone without an identifier', async () => {
    const { rpc } = setup({ MCP_IP_LIMITER: new MemoryRateLimiter(4) });
    for (let i = 0; i < 4; i++) expect(await textOf(await rpc(call(i)))).toContain('Corrèze');
    const limited = await rpc(call(5));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await rpc(call(6), '198.51.100.2')).status).toBe(200);
  });

  it('applies the per-IP limit to every MCP message, identifier or not', async () => {
    const { rpc } = setup({ MCP_IP_LIMITER: new MemoryRateLimiter(2) });
    expect((await rpc(list(1))).status).toBe(200);
    expect((await rpc(call(2, { 'openai/subject': 'a' }))).status).toBe(200);
    expect((await rpc(call(3, { 'openai/subject': 'b' }))).status).toBe(429);
  });

  it('answers 429 when a resource read is over the user limit', async () => {
    const { rpc } = setup({ MCP_USER_LIMITER: new MemoryRateLimiter(1) });
    const read = (id: number) => ({ jsonrpc: '2.0', id, method: 'resources/read', params: { uri: 'bredouille://especes', _meta: { 'openai/subject': 'r' } } });
    expect((await rpc(read(1))).status).toBe(200);
    expect((await rpc(read(2))).status).toBe(429);
  });
});

describe('daily cap', () => {
  it('turns tool calls away with a polite French tool error once over the cap', async () => {
    const { rpc, get } = setup({ DAILY_CAP: '2' });
    expect((await rpc(list(1))).status).toBe(200);
    expect((await rpc(list(2))).status).toBe(200);
    const res = await rpc(call(3, { 'openai/subject': 'alice' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolBody & { id: number };
    expect(body.id).toBe(3);
    expect(body.result?.isError).toBe(true);
    const text = body.result?.content[0]?.text ?? '';
    expect(text).toContain('Bredouille reçoit beaucoup de demandes aujourd’hui. Réessayez demain, ou consultez https://bredouille.app.');
    expect(text).toContain(SAFETY_LINE);
    // Protocol messages still answer, so the host can reach the tool and relay the message.
    expect((await rpc(list(4))).status).toBe(200);
    const plain = await get('/');
    expect(plain.status).toBe(429);
    expect(Number(plain.headers.get('retry-after'))).toBe(secondsToUtcMidnight(NOW));
    expect((await get('/health')).status).toBe(200);
  });

  it('is off with DAILY_CAP=0', async () => {
    const { rpc } = setup({ DAILY_CAP: '0' });
    for (let i = 0; i < 3; i++) expect(await textOf(await rpc(call(i)))).toContain('Corrèze');
  });

  it('resets at UTC midnight', () => {
    const c = new DailyCounter('a');
    expect(c.hit(new Date('2026-10-15T23:59:00Z'), 1, undefined).over).toBe(false);
    expect(c.hit(new Date('2026-10-15T23:59:30Z'), 1, undefined).over).toBe(true);
    expect(c.hit(new Date('2026-10-16T00:00:01Z'), 1, undefined).over).toBe(false);
  });

  it('sums the totals other isolates wrote to the shared store', async () => {
    const rows = new Map<string, number>();
    const store: CounterStore = {
      async put(key, _value, { metadata }) {
        rows.set(key, metadata.n);
      },
      async list({ prefix }) {
        return { keys: [...rows].filter(([k]) => k.startsWith(prefix)).map(([name, n]) => ({ name, metadata: { n } })), list_complete: true };
      },
    };
    const a = new DailyCounter('a', 2);
    const b = new DailyCounter('b', 2);
    const t = new Date('2026-10-15T10:00:00Z');
    a.hit(t, 0, store);
    await a.hit(t, 0, store).sync;
    expect(rows.get('2026-10-15:a')).toBe(2);
    b.hit(t, 0, store);
    await b.hit(t, 0, store).sync;
    expect(b.estimate()).toBe(4);
    expect(b.hit(t, 4, store).over).toBe(true);
    expect(a.hit(t, 4, store).over).toBe(false);
  });

  it('keeps counting when the store fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store: CounterStore = {
      put: () => Promise.reject(new Error('kv down')),
      list: () => Promise.reject(new Error('kv down')),
    };
    const c = new DailyCounter('a', 1);
    await c.hit(NOW, 10, store).sync;
    expect(c.estimate()).toBe(1);
    expect(warn).toHaveBeenCalledWith('[daily-cap]', 'Error');
  });
});

describe('logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never logs the user identifier or the address', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    }
    const { rpc } = setup({ MCP_USER_LIMITER: new MemoryRateLimiter(1) });
    const meta = { 'openai/subject': 'subject-secret-123', 'openai/session': 'session-secret-456' };
    await rpc(call(1, meta), '203.0.113.99', { 'mcp-session-id': 'header-secret-789' });
    await rpc(call(2, meta), '203.0.113.99');
    await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'conditions_lieu', arguments: { lat: 'x' }, _meta: meta } }, '203.0.113.99');
    const all = lines.join('\n');
    for (const secret of ['subject-secret-123', 'session-secret-456', 'header-secret-789', '203.0.113.99']) expect(all).not.toContain(secret);
  });
});
