#!/usr/bin/env node
/**
 * End-to-end smoke test: starts `wrangler dev` (workerd, local), then speaks MCP
 * to /mcp with the official SDK client: initialize, tools/list, resources/list,
 * tools/call. The call goes to the live api.bredouille.app unless --offline.
 *
 *   node scripts/smoke.mjs                  # conditions_lieu, cèpes near Tulle (live API)
 *   node scripts/smoke.mjs --offline        # regles_et_chasse 19 (bundled data; works without the API)
 *   node scripts/smoke.mjs --url https://mcp.bredouille.app/mcp   # against a deployed server, no wrangler
 */
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const port = Number(process.env.SMOKE_PORT ?? 8789);
const base = `http://127.0.0.1:${port}`;

async function waitForHealth(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not answer /health in time');
}

function startWrangler() {
  const child = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--log-level', 'warn'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  return { child, log: () => log };
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

const show = (label, value) => console.log(`\n>>> ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

let wrangler = null;
let failed = false;
try {
  if (!urlArg) {
    wrangler = startWrangler();
    await waitForHealth(60_000).catch((e) => {
      console.error(wrangler.log());
      throw e;
    });
  }
  const endpoint = new URL(urlArg ?? `${base}/mcp`);
  const client = new Client({ name: 'bredouille-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  show('initialize', { server: client.getServerVersion(), capabilities: client.getServerCapabilities() });

  const { tools } = await client.listTools();
  show('tools/list', tools.map((t) => ({ name: t.name, title: t.title, required: t.inputSchema.required ?? [], widget: t._meta?.['openai/outputTemplate'] ?? null })));
  if (tools.length !== 6) throw new Error(`expected 6 tools, got ${tools.length}`);

  const { resources } = await client.listResources();
  show('resources/list', resources.map((r) => `${r.uri} (${r.mimeType})`));

  const call = offline
    ? { name: 'regles_et_chasse', arguments: { departement: '19' } }
    : { name: 'conditions_lieu', arguments: { lat: 45.27, lon: 1.77, espece: 'cèpes' } };
  const result = await client.callTool(call);
  show(`tools/call ${call.name} ${JSON.stringify(call.arguments)}`, result.content[0]?.text ?? result);
  if (result.isError) throw new Error('tool call returned isError');
  if (!String(result.content[0]?.text).includes('Faites contrôler toute cueillette.')) throw new Error('safety line missing');
  await client.close();
  console.log('\nSMOKE OK');
} catch (error) {
  failed = true;
  console.error('\nSMOKE FAILED:', error instanceof Error ? error.message : error);
} finally {
  stop(wrangler?.child);
}
process.exit(failed ? 1 : 0);
