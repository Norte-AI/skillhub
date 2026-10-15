import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzip } from 'node:zlib';

const exec = promisify(execFile);
const decompress = promisify(gunzip);
const repositories = new Set(['codex.git', 'zcode.git']);
const loopback = value => value === '::1' || /^127\./.test(value ?? '') || /^::ffff:127\./.test(value ?? '');
const error = (message, status) => Object.assign(new Error(message), { status });
function send(res, status, message) {
  if (res.destroyed || res.writableEnded) return;
  if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${message}\n`);
}
function readBody(req, limit, timeoutMs) {
  return new Promise((accept, reject) => {
    const chunks = []; let bytes = 0;
    const finish = (failure, value) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted);
      if (failure) { req.resume(); reject(failure); } else accept(value);
    };
    const data = chunk => { bytes += chunk.length; if (bytes > limit) finish(error('Request body exceeds limit', 413)); else chunks.push(chunk); };
    const end = () => finish(null, Buffer.concat(chunks));
    const failed = () => finish(error('Request stream failed', 400));
    const aborted = () => finish(error('Request aborted', 400));
    const timer = setTimeout(() => finish(error('Request timeout', 408)), timeoutMs); timer.unref();
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}

/** Local-only smart HTTP clone/fetch. See https://git-scm.com/docs/git-http-backend. */
export function createGitHttpHandler({ rootDir, prefix = '/git', allowRemote = false, maxBodyBytes = 16 * 1024 * 1024, maxResponseBytes = 256 * 1024 * 1024, maxHeaderBytes = 16 * 1024, timeoutMs = 30000 } = {}) {
  if (!rootDir) throw new Error('Git repository rootDir is required');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid Git HTTP prefix');
  for (const value of [maxBodyBytes, maxResponseBytes, maxHeaderBytes, timeoutMs]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid Git HTTP limit');
  const root = resolve(rootDir);
  let backendPromise;
  const backend = () => backendPromise ??= exec('git', ['--exec-path'], { timeout: 5000, maxBuffer: 4096, env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).then(({ stdout }) => {
    const execPath = stdout.trim(); if (!execPath.startsWith('/')) throw new Error('Git executable path is not absolute');
    return { executable: join(execPath, 'git-http-backend'), execPath };
  });
  return async (req, res) => {
    const rawUrl = req.url ?? '';
    const [rawPath, query = ''] = rawUrl.split('?');
    if (rawPath !== prefix && !rawPath.startsWith(`${prefix}/`)) return false;
    try {
      if (!allowRemote && !loopback(req.socket?.remoteAddress)) throw error('Git HTTP is restricted to loopback clients', 403);
      // A strict canonical route avoids normalization and double-decoding ambiguity.
      if (rawPath.includes('%') || rawPath.includes('\\') || rawPath.includes('\0') || rawPath.split('/').some(segment => segment === '.' || segment === '..')) throw error('Invalid Git path', 400);
      const match = rawPath.slice(prefix.length).match(/^\/([^/]+)\/(info\/refs|git-upload-pack)$/);
      if (!match || !repositories.has(match[1])) throw error('Git endpoint not found', 404);
      const [, repository, endpoint] = match;
      const params = new URLSearchParams(query);
      if (endpoint === 'info/refs') {
        if (req.method !== 'GET') throw error('Method not allowed', 405);
        if (params.size !== 1 || params.get('service') !== 'git-upload-pack') throw error('Only upload-pack discovery is allowed', 403);
      } else {
        if (req.method !== 'POST') throw error('Method not allowed', 405);
        if (params.size) throw error('Unexpected Git query', 400);
        if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/x-git-upload-pack-request') throw error('Invalid Git Content-Type', 415);
        if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'gzip') throw error('Unsupported Git request encoding', 415);
      }
      if (Number(req.headers['content-length'] ?? 0) > maxBodyBytes) throw error('Request body exceeds limit', 413);
      const repo = await lstat(join(root, repository));
      if (!repo.isDirectory() || repo.isSymbolicLink()) throw error('Repository is not a managed directory', 404);
      let body = await readBody(req, endpoint === 'info/refs' ? 0 : maxBodyBytes, timeoutMs);
      if (req.headers['content-encoding'] === 'gzip') {
        try { body = await decompress(body, { maxOutputLength: maxBodyBytes }); }
        catch (failure) { throw error(failure.code === 'ERR_BUFFER_TOO_LARGE' ? 'Decoded Git body exceeds limit' : 'Invalid gzip body', failure.code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400); }
      }
      if (req.aborted || res.destroyed) return true;
      const { executable, execPath } = await backend();
      const home = await mkdtemp(join(tmpdir(), 'skillhub-git-http-'));
      try {
        await new Promise((complete, reject) => {
          const child = spawn(executable, [], { cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
            PATH: `${execPath}:/usr/bin:/bin`, HOME: home, XDG_CONFIG_HOME: home,
            GIT_EXEC_PATH: execPath, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'http.receivepack', GIT_CONFIG_VALUE_0: 'false',
            GIT_CONFIG_KEY_1: 'http.getanyfile', GIT_CONFIG_VALUE_1: 'false',
            GIT_CONFIG_KEY_2: 'http.uploadpack', GIT_CONFIG_VALUE_2: 'true',
            PATH_INFO: `/${repository}/${endpoint}`, REQUEST_METHOD: req.method, QUERY_STRING: query,
            CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: String(body.length),
            REMOTE_ADDR: req.socket.remoteAddress, GIT_PROTOCOL: req.headers['git-protocol'] === 'version=2' ? 'version=2' : ''
          } });
          let headers = Buffer.alloc(0); let parsed = false; let failure; let killTimer; let responseBytes = 0;
          const signal = value => { try { if (child.pid) process.kill(-child.pid, value); } catch { child.kill(value); } };
          const kill = () => { signal('SIGTERM'); killTimer ??= setTimeout(() => signal('SIGKILL'), 1000); killTimer.unref(); };
          const fail = reason => { failure ??= reason; kill(); };
          const aborted = () => { if (!res.writableEnded) fail(error('Client disconnected', 499)); };
          req.once('aborted', aborted); res.once('close', aborted);
          const timer = setTimeout(() => fail(error('Git backend timed out', 504)), timeoutMs); timer.unref();
          child.stdin.on('error', () => {});
          child.stderr.resume();
          const write = chunk => {
            responseBytes += chunk.length;
            if (responseBytes > maxResponseBytes) { fail(error('Git backend response exceeds limit', 502)); return; }
            if (!res.destroyed && !res.write(chunk)) { child.stdout.pause(); res.once('drain', () => child.stdout.resume()); }
          };
          child.stdout.on('data', chunk => {
            if (failure) return;
            if (parsed) { write(chunk); return; }
            headers = Buffer.concat([headers, chunk]);
            let offset = headers.indexOf('\r\n\r\n'); let separator = 4;
            if (offset < 0) { offset = headers.indexOf('\n\n'); separator = 2; }
            if ((offset < 0 && headers.length > maxHeaderBytes) || offset > maxHeaderBytes) { fail(error('Git backend headers exceed limit', 502)); return; }
            if (offset < 0) return;
            try {
              let status = 200; const responseHeaders = {};
              for (const line of headers.subarray(0, offset).toString('utf8').split(/\r?\n/)) {
                const colon = line.indexOf(':'); if (colon < 1) throw new Error('Malformed CGI header');
                const key = line.slice(0, colon).toLowerCase(); const value = line.slice(colon + 1).trim();
                if (key === 'status') { status = Number(value.split(' ')[0]); if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('Malformed CGI status'); }
                else if (['content-type', 'cache-control', 'expires', 'pragma', 'content-length'].includes(key)) responseHeaders[key] = value;
              }
              res.writeHead(status, responseHeaders); parsed = true; write(headers.subarray(offset + separator)); headers = null;
            } catch { fail(error('Invalid Git backend headers', 502)); }
          });
          child.once('error', () => { failure ??= error('Git backend unavailable', 503); });
          child.once('close', code => {
            clearTimeout(timer); clearTimeout(killTimer); req.off('aborted', aborted); res.off('close', aborted);
            if (failure) reject(failure);
            else if (code !== 0 || !parsed) reject(error('Git backend failed', 502));
            else { res.end(); complete(); }
          });
          child.stdin.end(body);
        });
      } finally { await rm(home, { recursive: true, force: true }); }
    } catch (failure) {
      if (!res.headersSent) send(res, failure.status ?? (failure.code === 'ENOENT' ? 404 : 503), failure.status ? failure.message : 'Git repository unavailable');
      else if (!res.writableEnded) res.destroy();
      req.resume();
    }
    return true;
  };
}
