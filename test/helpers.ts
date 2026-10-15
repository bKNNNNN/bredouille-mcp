import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createDataSource, type DataSource } from '../src/bredouille';
import { createMcpServer } from '../src/server';
import type { ToolContext } from '../src/tools/common';
import { Http, type Fetcher } from '../src/upstream';
import accuracy from './fixtures/accuracy.json';
import communeAt from './fixtures/commune-at.json';
import communesTulle from './fixtures/communes-tulle.json';
import drivers from './fixtures/drivers.json';
import manifest from './fixtures/manifest.json';
import point from './fixtures/point.json';
import rules from './fixtures/rules.json';

/** The fixtures were captured on 2026-10-15 (run 2026-10-15), so "now" is that morning in Paris. */
export const NOW = new Date('2026-10-15T08:00:00Z');
export const SITE = 'https://bredouille.app';
export const API = 'https://api.test';

export type Route = (url: URL) => { status: number; body: unknown } | null;

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Default routes: every upstream answer from a fixture; unknown URLs are a 404. */
export const defaultRoute: Route = (url) => {
  const p = url.pathname;
  if (url.hostname === 'api.test') {
    if (p === '/api/manifest') return { status: 200, body: manifest };
    if (p === '/api/point') return { status: 200, body: point };
    if (p === '/api/drivers') return { status: 200, body: drivers };
    if (p === '/data/latest/accuracy.json') return { status: 200, body: accuracy };
    if (p === '/out/access/rules.json') return { status: 200, body: rules };
  }
  if (url.hostname === 'geo.api.gouv.fr') {
    if (p === '/communes' && url.searchParams.has('lat')) return { status: 200, body: communeAt };
    if (p === '/communes' && url.searchParams.get('nom')?.toLowerCase() === 'tulle') return { status: 200, body: communesTulle };
    if (p === '/communes') return { status: 200, body: [] };
    if (p.startsWith('/departements/')) return { status: 200, body: communesTulle };
  }
  return null;
};

export interface MockFetch extends Fetcher {
  readonly calls: URL[];
}

export function mockFetch(route: Route = defaultRoute): MockFetch {
  const calls: URL[] = [];
  return {
    calls,
    async fetch(input: Request | string) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      calls.push(url);
      const r = route(url) ?? defaultRoute(url);
      return r ? reply(r.status, r.body) : reply(404, { error: 'Introuvable' });
    },
  };
}

export function testData(fetcher: Fetcher = mockFetch()): DataSource {
  return createDataSource(new Http({ fetcher, timeoutMs: 1_000 }), API);
}

export function testContext(fetcher: Fetcher = mockFetch()): ToolContext {
  return { data: testData(fetcher), siteUrl: SITE, now: () => NOW };
}

export async function connectedClient(ctx: ToolContext = testContext()): Promise<Client> {
  const server = createMcpServer(ctx);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

export function textOf(result: unknown): string {
  const r = result as CallToolResult;
  const first = r.content[0];
  return first && first.type === 'text' ? first.text : '';
}
