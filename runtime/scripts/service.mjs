import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, writeFile, unlink, access, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configuredDatabaseUrl } from './db-config.mjs';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function parseServiceOptions(args) {
  if (args.length !== 1 || !['start', 'status', 'stop'].includes(args[0])) throw new Error('Usage: node scripts/service.mjs start|status|stop');
  return { action: args[0] };
}
export function ownedProcess(record, info, entry) {
  if (!record || !Number.isSafeInteger(record.pid) || record.pid < 2 || record.entry !== entry || !record.identity || !info) return false;
  return info.identity === record.identity && info.command === `${record.executable} ${entry}`;
}
async function processInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try {
    const [command, identity] = await Promise.all([exec('ps', ['-p', String(pid), '-o', 'command=']), exec('ps', ['-p', String(pid), '-o', 'lstart='])]);
    return { command: command.stdout.trim(), identity: identity.stdout.trim() };
  } catch { return null; }
}
async function readiness(url) {
  try { const response = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(750) }); return response.ok; } catch { return false; }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function recordAt(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Invalid managed service PID file; inspect it before continuing'); }
}
export async function manageService({ action }) {
  const dataDir = resolve(root, process.env.SKILLHUB_DATA_DIR || '.skillhub-data');
  const entry = resolve(root, 'apps/server/src/index.mjs');
  const pidFile = resolve(dataDir, 'server.pid.json');
  const logFile = resolve(dataDir, 'server.log');
  const port = Number(process.env.PORT || 4317);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const host = process.env.SKILLHUB_HOST || '127.0.0.1';
  const probeHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const url = `http://${probeHost.includes(':') ? `[${probeHost}]` : probeHost}:${port}`;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let lock;
  if (action !== 'status') {
    try { lock = await open(resolve(dataDir, '.service.lock'), 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Another service operation is active; inspect .service.lock if a previous operation was interrupted'); throw error; }
  }
  try {
    const record = await recordAt(pidFile);
    const info = await processInfo(record?.pid);
    const owned = ownedProcess(record, info, entry);
    if (action === 'status') return { managed: owned, running: Boolean(info), ready: await readiness(url), ...(owned ? { pid: record.pid } : {}), url, logFile, ...(record && !owned ? { warning: 'PID file does not identify the managed service' } : {}) };
    if (action === 'stop') {
      if (!record) return { stopped: false, reason: 'No managed service PID file' };
      if (info && !owned) throw new Error('PID ownership check failed; refusing to stop another process');
      if (!info) { await unlink(pidFile); return { stopped: false, reason: 'Managed process already exited' }; }
      process.kill(record.pid, 'SIGTERM');
      for (let i = 0; i < 100; i++) {
        await pause(100);
        const current = await processInfo(record.pid);
        if (!current || !ownedProcess(record, current, entry)) { await unlink(pidFile); return { stopped: true, pid: record.pid }; }
      }
      throw new Error('Managed process did not exit after SIGTERM; PID file preserved for inspection');
    }
    if (owned) return { started: false, alreadyRunning: true, pid: record.pid, ready: await readiness(url), url, logFile };
    if (info) throw new Error('Stale PID now belongs to another process; inspect the PID file before starting');
    if (await readiness(url)) throw new Error('A service already responds on this port but is not managed here; stop it before starting');
    if (record) await unlink(pidFile);
    const env = { ...process.env, SKILLHUB_DATA_DIR: dataDir, SKILLHUB_DATABASE_URL: configuredDatabaseUrl() };
    const defaultKey = resolve(root, '.skillhub-keys/private.pem');
    if (!env.SKILLHUB_SIGNING_KEY_FILE) { try { await access(defaultKey); env.SKILLHUB_SIGNING_KEY_FILE = defaultKey; } catch { /* Signing remains optional when no local key exists. */ } }
    const log = await open(logFile, 'a', 0o600);
    await chmod(logFile, 0o600);
    let child;
    try {
      child = spawn(process.execPath, [entry], { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally { await log.close(); }
    const identity = await processInfo(child.pid);
    if (!identity) throw new Error(`Service exited during startup; inspect ${logFile}`);
    const managedRecord = { pid: child.pid, entry, executable: process.execPath, identity: identity.identity, url, createdAt: new Date().toISOString() };
    await writeFile(pidFile, JSON.stringify(managedRecord, null, 2), { mode: 0o600, flag: 'wx' });
    for (let i = 0; i < 60; i++) {
      if (await readiness(url)) return { started: true, pid: child.pid, ready: true, url, logFile };
      if (!ownedProcess(managedRecord, await processInfo(child.pid), entry)) throw new Error(`Service exited during startup; inspect ${logFile}`);
      await pause(250);
    }
    throw new Error(`Service started but readiness timed out; inspect ${logFile} and run status`);
  } finally { if (lock) { await lock.close(); await unlink(resolve(dataDir, '.service.lock')); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await manageService(parseServiceOptions(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
