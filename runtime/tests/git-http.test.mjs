import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createGitHttpHandler } from '../packages/git-http/index.mjs';

const exec = promisify(execFile);
test('Git smart HTTP supports real ls-remote, clone and fetch while denying all writes and arbitrary files', async t => {
  const sandbox = await mkdtemp(join(tmpdir(), 'skillhub-git-http-test-'));
  const rootDir = join(sandbox, 'repositories'); await mkdir(rootDir);
  const source = join(sandbox, 'source'); await mkdir(source);
  const env = { PATH: process.env.PATH, HOME: sandbox, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => exec('git', args, { env, timeout: 10000, maxBuffer: 1024 * 1024 });
  await git('init', '-b', 'main', source);
  await writeFile(join(source, 'rules.txt'), 'First rules');
  await git('-C', source, 'add', '.');
  await git('-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial');
  await git('clone', '--bare', source, join(rootDir, 'codex.git'));
  await git('clone', '--bare', source, join(rootDir, 'zcode.git'));
  const handler = createGitHttpHandler({ rootDir, maxBodyBytes: 4096 });
  const http = createServer((req, res) => handler(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end('No route'); } }));
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); await rm(sandbox, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const remote = `${base}/git/codex.git`;
  assert.match((await git('ls-remote', remote)).stdout, /refs\/heads\/main/);
  assert.match((await git('ls-remote', `${base}/git/zcode.git`)).stdout, /refs\/heads\/main/);
  const clone = join(sandbox, 'clone'); await git('clone', remote, clone);
  assert.equal(await readFile(join(clone, 'rules.txt'), 'utf8'), 'First rules');
  await writeFile(join(source, 'rules.txt'), 'Updated rules');
  await git('-C', source, 'add', '.');
  await git('-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Update');
  await git('-C', join(rootDir, 'codex.git'), 'fetch', source, 'main:main');
  await git('-C', clone, 'fetch', 'origin');
  assert.equal((await git('-C', clone, 'show', 'origin/main:rules.txt')).stdout, 'Updated rules');
  await assert.rejects(git('-C', clone, 'push', 'origin', 'main'), /403|404|forbidden|not found/i);
  for (const path of ['/git/codex.git/config', '/git/codex.git/HEAD', '/git/codex.git/objects/info/packs', '/git/unknown.git/info/refs?service=git-upload-pack', '/git/codex.git/git-receive-pack', '/anything']) assert.equal((await fetch(`${base}${path}`)).status, 404);
  assert.equal((await fetch(`${remote}/info/refs?service=git-receive-pack`)).status, 403);
  assert.equal((await fetch(`${remote}/info/refs?service=git-upload-pack&service=git-receive-pack`)).status, 403);
  assert.equal((await fetch(`${remote}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request' }, body: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(`${remote}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request', 'content-encoding': 'gzip' }, body: gzipSync('x'.repeat(5000)) })).status, 413);
  assert.equal((await fetch(`${remote}/git-upload-pack`, { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request', 'content-encoding': 'gzip' }, body: gzipSync('0000') })).status, 200);
  // Raw HTTP avoids URL normalization hiding traversal cases.
  const raw = path => new Promise((accept, reject) => { const req = request(`${base}`, { path }, res => { res.resume(); res.once('end', () => accept(res.statusCode)); }); req.once('error', reject); req.end(); });
  for (const path of ['/git/../codex.git/info/refs', '/git/codex.git%2fconfig', '/git/%252e%252e/config', '/git/codex.git/%00']) assert.equal(await raw(path), 400);
  await rm(join(rootDir, 'zcode.git'), { recursive: true }); await symlink(join(rootDir, 'codex.git'), join(rootDir, 'zcode.git'));
  assert.equal((await fetch(`${base}/git/zcode.git/info/refs?service=git-upload-pack`)).status, 404);
});

test('Git transport rejects nonlocal sockets without starting subprocesses', async () => {
  const handler = createGitHttpHandler({ rootDir: '/path-that-does-not-exist' });
  const response = { headersSent: false, writableEnded: false, writeHead(status) { this.status = status; this.headersSent = true; }, end() { this.writableEnded = true; } };
  const req = { url: '/git/codex.git/info/refs?service=git-upload-pack', socket: { remoteAddress: '10.0.0.5' }, resume() {} };
  assert.equal(await handler(req, response), true); assert.equal(response.status, 403);
});

test('remote Git access needs explicit configuration and ignores forwarded client headers', async () => {
  const response = () => ({ headersSent: false, writableEnded: false, writeHead(status) { this.status = status; this.headersSent = true; }, end() { this.writableEnded = true; } });
  const req = { method: 'GET', url: '/git/codex.git/info/refs?service=git-upload-pack', headers: { 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '10.0.0.5' }, resume() {} };
  let res = response(); await createGitHttpHandler({ rootDir: '/does-not-exist' })(req, res); assert.equal(res.status, 403);
  res = response(); await createGitHttpHandler({ rootDir: '/does-not-exist', allowRemote: true })(req, res); assert.equal(res.status, 404);
});
