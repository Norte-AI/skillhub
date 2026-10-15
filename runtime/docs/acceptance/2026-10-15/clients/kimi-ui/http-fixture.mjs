// Run from repository root. Synthetic loopback-only acceptance service, never production.
import { createServer } from 'node:http';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('.');
const { HubStore } = await import(pathToFileURL(join(root, 'packages/core/index.mjs')));
const { handleMcpRequest } = await import(pathToFileURL(join(root, 'apps/mcp/src/index.mjs')));
const dir = await mkdtemp(join(tmpdir(), 'kimi-http-fixture-'));
const store = await new HubStore({ dataDir: dir }).init();
await store.saveContent({ id: 'hub-session-rule', kind: 'rule', title: 'Acceptance', body: 'hub_probe_release = v1' });
await store.saveBundle({ id: 'session-probe', name: 'Acceptance', items: ['hub-session-rule'], targets: ['kimi'] });
const old = await store.buildRelease('session-probe', '1.0.0');
await store.saveContent({ id: 'hub-session-rule', kind: 'rule', title: 'Acceptance', body: 'hub_probe_release = v2' });
const current = await store.buildRelease('session-probe', '1.1.0');
await store.setChannel('session-probe', 'stable', current.id);
const logfile = resolve(process.env.KIMI_FIXTURE_LOG || '/private/tmp/kimi-http-methods.jsonl');
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { if (raw.length < 65536) raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      appendFile(logfile, JSON.stringify({ at: new Date().toISOString(), method: body.method, tool: body.params?.name, releaseId: body.params?.arguments?.releaseId }) + '\n', { mode: 0o600 }).catch(() => {});
    } catch { /* Non-JSON discovery requests contain no method. */ }
  });
  return handleMcpRequest(req, res, { store, identity: { role: 'admin' } });
});
server.listen(48971, '127.0.0.1', () => console.log(JSON.stringify({ fixture: true, url: 'http://127.0.0.1:48971/mcp', release: old.id, stable: current.id, log: logfile })));
let closing = false;
const stop = () => { if (closing) return; closing = true; server.closeAllConnections(); server.close(async () => { await rm(dir, { recursive: true, force: true }); process.exit(); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
