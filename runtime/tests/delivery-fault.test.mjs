import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { run } from '../apps/cli/src/index.mjs';

test('killed download never commits an install; stale lock is diagnosable and offline first install fails', async t => {
  const home = await mkdtemp(join(tmpdir(), 'skillhub-kill-download-'));
  let downloading;
  const reachedDownload = new Promise(resolve => { downloading = resolve; });
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/resolve?')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ releaseId: 'demo@1.0.0' })); }
    else if (req.url.includes('/api/artifacts/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"manifest":'); downloading(); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let child;
  t.after(async () => { child?.kill('SIGKILL'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env }; delete env.SKILLHUB_DATABASE_URL; delete env.SKILLHUB_TOKEN;
  child = spawn(process.execPath, [fileURLToPath(new URL('../apps/cli/src/index.mjs', import.meta.url)), 'install', 'demo', '--client', 'codex', '--home', home, '--server', url], { env, stdio: 'ignore' });
  let timer;
  try { await Promise.race([reachedDownload, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('download never started')), 5000); })]); } finally { clearTimeout(timer); }
  const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
  await assert.rejects(readFile(join(home, 'state', 'codex.json')), { code: 'ENOENT' });
  const report = await run(['doctor', '--home', home], () => {});
  assert.equal(report.status, 'error');
  // CLI deliberately leaves the lock for explicit operator recovery; never auto-break live locks.
  assert.ok(await lstat(join(home, '.operation-lock')));
  await rm(join(home, '.operation-lock'), { recursive: true });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await assert.rejects(run(['install', 'demo', '--client', 'codex', '--home', home, '--server', url], () => {}));
  await assert.rejects(readFile(join(home, 'state', 'codex.json')), { code: 'ENOENT' });
});
