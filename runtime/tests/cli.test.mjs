import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { run, digest, safeId } from '../apps/cli/src/index.mjs';

test('CLI stages, verifies, backs up, rolls back and uninstalls within isolated home', async t => {
  const home = await mkdtemp(join(tmpdir(), 'skillhub-cli-'));
  const releases = { r1: 'first rules', r2: 'updated rules', bad: 'bad rules' };
  let stable = 'r1';
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/bundles') return res.end(JSON.stringify([{ id: 'demo' }]));
    if (req.url === '/api/resolve?bundle=demo&ref=stable') return res.end(JSON.stringify({ releaseId: stable }));
    const match = req.url.match(/^\/api\/artifacts\/(r1|r2|bad)\/(codex|kimi|zcode)$/);
    if (!match) { res.statusCode = 404; return res.end('{}'); }
    const [, releaseId, target] = match;
    const content = releases[releaseId];
    res.end(JSON.stringify({ manifest: { releaseId, target, bundleId: 'demo', version: releaseId, digest: releaseId === 'bad' ? 'invalid' : digest(content) }, content }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const base = ['--server', address, '--home', home]; const quiet = () => {};
  assert.deepEqual(await run(['list', ...base], quiet), [{ id: 'demo' }]);
  for (const client of ['codex', 'kimi', 'zcode']) {
    const state = await run(['install', 'demo', '--client', client, ...base], quiet);
    assert.equal(state.status, 'staged'); assert.equal(state.loaded, false);
  }
  assert.equal((await run(['doctor', '--home', home], quiet)).clients.length, 3);
  stable = 'r2'; await run(['install', 'demo', '--client', 'codex', ...base], quiet);
  assert.ok((await readdir(join(home, 'backups'))).length);
  await run(['rollback', '--release', 'r1', '--client', 'codex', '--home', home], quiet);
  const statePath = join(home, 'state', 'codex.json');
  const before = await readFile(statePath, 'utf8'); assert.equal(JSON.parse(before).releaseId, 'r1');
  stable = 'bad';
  await assert.rejects(run(['install', 'demo', '--client', 'codex', ...base], quiet), /digest/);
  assert.equal(await readFile(statePath, 'utf8'), before);
  const cached = join(home, 'cache', 'r1', 'codex.json');
  const artifact = JSON.parse(await readFile(cached, 'utf8')); artifact.content = 'tampered';
  await writeFile(cached, JSON.stringify(artifact));
  assert.equal((await run(['doctor', '--home', home], quiet)).status, 'error');
  await assert.rejects(run(['rollback', '--release', 'r1', '--client', 'codex', ...base], quiet), /digest/);
  assert.equal(await readFile(statePath, 'utf8'), before);
  await run(['uninstall', '--client', 'codex', '--home', home], quiet);
  await assert.rejects(readFile(statePath), { code: 'ENOENT' });
  assert.ok(await readFile(join(home, 'state', 'kimi.json')));
  assert.ok(await readFile(cached));
  assert.deepEqual((await readdir(home)).sort(), ['backups', 'cache', 'state']);
});

test('rejects unsafe identifiers and unsupported clients', async () => {
  for (const value of ['../x', 'a/b', '/tmp', '..', '', 'a..b']) assert.throws(() => safeId(value));
  await assert.rejects(run(['uninstall', '--client', '../../x'], () => {}), /Client/);
});

test('operation lock refuses concurrent operations and doctor reports it without removing it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'skillhub-lock-'));
  let resolveEntered; const entered = new Promise(resolve => { resolveEntered = resolve; });
  let releaseRequest; const gate = new Promise(resolve => { releaseRequest = resolve; });
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/resolve')) { resolveEntered(); await gate; res.end(JSON.stringify({ releaseId: 'demo@1.0.0' })); }
    else res.end(JSON.stringify({ manifest: { releaseId: 'demo@1.0.0', bundleId: 'demo', target: 'codex', version: '1.0.0', digest: digest('rules') }, content: 'rules' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { releaseRequest(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  const first = run(['install', 'demo', '--client', 'codex', '--home', home, '--server', `http://127.0.0.1:${server.address().port}`], () => {});
  await entered;
  await assert.rejects(run(['uninstall', '--client', 'codex', '--home', home], () => {}), /operation.*running|lock remains/);
  const result = await run(['doctor', '--home', home], () => {});
  assert.equal(result.status, 'error'); assert.match(result.problems[0].error, /lock/);
  assert.ok((await lstat(join(home, '.operation-lock'))).isDirectory());
  releaseRequest(); await first;
  await assert.rejects(lstat(join(home, '.operation-lock')), { code: 'ENOENT' });
  await mkdir(join(home, '.operation-lock'));
  await assert.rejects(run(['uninstall', '--client', 'codex', '--home', home], () => {}), /not automatically reclaimed/);
  assert.ok((await lstat(join(home, '.operation-lock'))).isDirectory());
});

test('managed directory symlinks are rejected without writing outside home; root symlink is allowed', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'skillhub-symlink-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const external = join(sandbox, 'external'); await mkdir(external);
  await writeFile(join(external, 'sentinel'), 'untouched');
  for (const directory of ['state', 'cache', 'backups']) {
    const home = join(sandbox, directory); await mkdir(home);
    await symlink(external, join(home, directory));
    await assert.rejects(run(['uninstall', '--client', 'codex', '--home', home], () => {}), /Unsafe managed directory/);
    assert.equal((await run(['doctor', '--home', home], () => {})).status, 'error');
    await assert.rejects(lstat(join(home, '.operation-lock')), { code: 'ENOENT' });
  }
  const home = join(sandbox, 'nested'); await mkdir(home); await mkdir(join(home, 'cache'));
  await mkdir(join(home, 'state'));
  await writeFile(join(home, 'state', 'codex.json'), JSON.stringify({ bundleId: 'demo', releaseId: 'demo@1.0.0' }));
  await symlink(external, join(home, 'cache', 'demo@1.0.0'));
  await assert.rejects(run(['rollback', '--release', 'demo@1.0.0', '--client', 'codex', '--home', home], () => {}), /Unsafe managed directory/);
  assert.deepEqual(await readdir(external), ['sentinel']);
  assert.equal(await readFile(join(external, 'sentinel'), 'utf8'), 'untouched');
  const actual = join(sandbox, 'actual'); await mkdir(actual);
  const alias = join(sandbox, 'alias'); await symlink(actual, alias);
  assert.equal((await run(['uninstall', '--client', 'codex', '--home', alias], () => {})).status, 'uninstalled');
});
