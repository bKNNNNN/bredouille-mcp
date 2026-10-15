import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from '../src/rate-limit';
import { createWorker, type Env } from '../src/worker';
import { NOW, testData } from './helpers';

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
const worker = createWorker({ data: testData(), now: () => NOW });

const rpc = (body: unknown, env: Env = {}, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request('https://mcp.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'cf-connecting-ip': '198.51.100.1', ...headers },
      body: JSON.stringify(body),
    }),
    { MCP_LIMITER: new MemoryRateLimiter(100), ...env },
    ctx,
  );

describe('worker /mcp (stateless Streamable HTTP, JSON responses)', () => {
  it('initializes without a session id', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(body.result.serverInfo.name).toBe('bredouille');
    expect(body.result.instructions).toContain('comestible');
  });

  it('lists tools and calls one on a fresh request', async () => {
    const list = (await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools).toHaveLength(6);
    const call = (await (
      await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'conditions_lieu', arguments: { lat: 45.27, lon: 1.77, espece: 'cepes' } } })
    ).json()) as { result: { content: { text: string }[] } };
    expect(call.result.content[0]!.text).toContain('Cèpes');
  });

  it('refuses GET, oversized bodies and clients over the limit', async () => {
    const get = await worker.fetch(new Request('https://mcp.test/mcp'), {}, ctx);
    expect(get.status).toBe(405);
    const big = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { pad: 'x'.repeat(70_000) } });
    expect(big.status).toBe(413);
    const env: Env = { MCP_LIMITER: new MemoryRateLimiter(1) };
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} }, env)).status).toBe(200);
    const limited = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} }, env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('adds the safety footer to argument validation errors', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'conditions_lieu', arguments: { lat: 'abc', lon: 1 } } });
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain('Faites contrôler toute cueillette.');
    expect(body.result.content[0]!.text).toContain('https://bredouille.app/#carte');
  });

  it('refuses a chunked body over the cap without a content-length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 8) c.enqueue(chunk);
        else c.close();
      },
    });
    const res = await worker.fetch(
      new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit),
      { MCP_LIMITER: new MemoryRateLimiter(100) },
      ctx,
    );
    expect(res.status).toBe(413);
  });

  it('answers CORS preflight, health and unknown paths', async () => {
    const pre = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'OPTIONS' }), {}, ctx);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
    expect((await worker.fetch(new Request('https://mcp.test/health'), {}, ctx)).status).toBe(200);
    expect((await worker.fetch(new Request('https://mcp.test/nope'), {}, ctx)).status).toBe(404);
    const challenge = await worker.fetch(new Request('https://mcp.test/.well-known/openai-apps-challenge'), { OPENAI_APPS_CHALLENGE: 'tok-123' }, ctx);
    expect(await challenge.text()).toBe('tok-123');
    expect((await worker.fetch(new Request('https://mcp.test/.well-known/openai-apps-challenge'), {}, ctx)).status).toBe(404);
  });
});
