#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, readdir, lstat, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyArtifactSignature } from '../../../packages/signing/index.mjs';

const clients = new Set(['codex', 'kimi', 'zcode']);
export const digest = content => createHash('sha256').update(content, 'utf8').digest('hex');
export function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9@._-]{0,127}$/.test(value) || value.includes('..')) throw new Error('Unsafe or missing identifier');
  return value;
}
function clientId(value) {
  if (!clients.has(value)) throw new Error('Client must be codex, kimi, or zcode');
  return value;
}
async function jsonFile(path) {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Unsafe managed file: ${path}`);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function safeDirectory(path, create = false) {
  let entry;
  try { entry = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return false;
    try { await mkdir(path, { mode: 0o700 }); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
    entry = await lstat(path);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Unsafe managed directory: ${path}`);
  return true;
}
async function atomicJson(path, data) {
  await safeDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
export function verifyArtifact(artifact, releaseId, client, bundleId) {
  const m = artifact?.manifest;
  if (!m || typeof artifact.content !== 'string') throw new Error('Invalid artifact');
  if (m.releaseId !== releaseId || m.target !== client || (bundleId && m.bundleId !== bundleId)) throw new Error('Artifact identity mismatch');
  safeId(m.bundleId);
  if (typeof m.version !== 'string' || !m.version || m.digest !== digest(artifact.content)) throw new Error('Artifact digest or version invalid');
  return artifact;
}
async function fetchJson(server, pathname) {
  if (!server) throw new Error('--server is required');
  const base = new URL(server);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Server must use HTTP or HTTPS');
  const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(15000), headers: process.env.SKILLHUB_TOKEN ? { Authorization: `Bearer ${process.env.SKILLHUB_TOKEN}` } : {} });
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return response.json();
}
function parse(args) {
  const [command, ...rest] = args;
  const options = {}; const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      if (!['server', 'home', 'client', 'release', 'trusted-keys'].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Invalid option ${rest[i]}`);
      options[key] = rest[++i];
    } else positional.push(rest[i]);
  }
  return { command, options, positional };
}
export async function run(args, output = console.log) {
  const { command, options: o, positional } = parse(args);
  const trustedKeys = o['trusted-keys'] ? await jsonFile(resolve(o['trusted-keys'])) : undefined;
  if (o['trusted-keys'] && (!trustedKeys || typeof trustedKeys !== 'object' || Array.isArray(trustedKeys))) throw new Error('Trusted keys must be a JSON map of key ids to public PEM keys');
  const verify = (artifact, releaseId, client, bundleId) => {
    verifyArtifact(artifact, releaseId, client, bundleId);
    if (trustedKeys) verifyArtifactSignature(artifact, artifact.signature, { trustedKeys, releaseDigest: artifact.signature?.releaseDigest });
    return artifact;
  };
  const home = resolve(o.home || join(homedir(), '.skillhub'));
  const states = join(home, 'state'); const cache = join(home, 'cache'); const backups = join(home, 'backups');
  if (command === 'list') {
    if (positional.length) throw new Error('list takes no bundle argument');
    const result = await fetchJson(o.server, '/api/bundles'); output(JSON.stringify(result, null, 2)); return result;
  }
  if (command === 'doctor') {
    if (positional.length) throw new Error('doctor takes no bundle argument');
    const result = { home, status: 'ok', clients: [], problems: [] };
    try {
      await lstat(join(home, '.operation-lock'));
      result.problems.push({ error: 'Operation lock exists: an operation may be running or a lock may remain. Retry after checking the owning process.' });
    } catch (error) { if (error.code !== 'ENOENT') result.problems.push({ error: error.message }); }
    try { for (const path of [states, cache, backups]) await safeDirectory(path); }
    catch (error) { result.problems.push({ error: error.message }); result.status = 'error'; output(JSON.stringify(result, null, 2)); return result; }
    for (const client of clients) {
      try {
        const state = await jsonFile(join(states, `${client}.json`));
        if (!state) continue;
        safeId(state.releaseId);
        await safeDirectory(join(cache, state.releaseId));
        const artifact = await jsonFile(join(cache, state.releaseId, `${client}.json`));
        verify(artifact, state.releaseId, client, state.bundleId);
        if (state.digest !== artifact.manifest.digest || state.status !== 'staged') throw new Error('State mismatch');
        result.clients.push({ client, releaseId: state.releaseId, status: 'staged', loaded: false });
      } catch (error) { result.problems.push({ client, error: error.message }); }
    }
    // Also verify inactive releases so a corrupt rollback cache is visible.
    let releases = [];
    try { releases = await readdir(cache); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const release of releases) {
      try {
        safeId(release);
        await safeDirectory(join(cache, release));
        for (const file of await readdir(join(cache, release))) {
          const client = file.replace(/\.json$/, ''); clientId(client);
          verify(await jsonFile(join(cache, release, file)), release, client);
        }
      } catch (error) { result.problems.push({ releaseId: release, error: error.message }); }
    }
    if (result.problems.length) result.status = 'error';
    output(JSON.stringify(result, null, 2)); return result;
  }
  if (!['install', 'rollback', 'uninstall'].includes(command)) throw new Error('Usage: list | install <bundle-id> | rollback --release <id> | uninstall --client <client> | doctor');
  const client = clientId(o.client);
  if (command !== 'install' && positional.length) throw new Error(`${command} takes no bundle argument`);
  await mkdir(home, { recursive: true });
  const lockPath = join(home, '.operation-lock');
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another operation is running or a lock remains. Check the owning process and retry; locks are not automatically reclaimed.'); throw error; }
  try {
  for (const path of [states, backups, cache]) await safeDirectory(path, true);
  const statePath = join(states, `${client}.json`);
  const previous = await jsonFile(statePath);
  if (command === 'uninstall') {
    if (previous) { await atomicJson(join(backups, `${client}-${randomUUID()}.json`), previous); await rm(statePath); }
    const result = { client, status: 'uninstalled', cacheRetained: true, globalConfigModified: false };
    output(JSON.stringify(result, null, 2)); return result;
  }
  let bundleId; let releaseId;
  if (command === 'install') {
    if (positional.length !== 1) throw new Error('install requires one bundle identifier');
    bundleId = safeId(positional[0]);
    const resolved = await fetchJson(o.server, `/api/resolve?bundle=${encodeURIComponent(bundleId)}&ref=stable`);
    releaseId = safeId(resolved.releaseId ?? resolved.release?.releaseId ?? resolved.release?.id ?? resolved.id);
  } else {
    releaseId = safeId(o.release);
    if (!previous) throw new Error('No installed staged release to roll back');
    bundleId = safeId(previous.bundleId);
  }
  const artifactPath = join(cache, releaseId, `${client}.json`);
  await safeDirectory(join(cache, releaseId));
  let artifact = await jsonFile(artifactPath);
  if (!artifact) artifact = await fetchJson(o.server, `/api/artifacts/${encodeURIComponent(releaseId)}/${client}`);
  verify(artifact, releaseId, client, bundleId);
  for (const path of [states, backups, cache]) await safeDirectory(path);
  await safeDirectory(join(cache, releaseId), true);
  await atomicJson(artifactPath, artifact);
  if (previous) await atomicJson(join(backups, `${client}-${randomUUID()}.json`), previous);
  const state = { client, releaseId, bundleId: artifact.manifest.bundleId, version: artifact.manifest.version, digest: artifact.manifest.digest, status: 'staged', loaded: false, signatureVerified: Boolean(trustedKeys), updatedAt: new Date().toISOString() };
  await atomicJson(statePath, state);
  output(JSON.stringify({ ...state, message: 'Downloaded and staged only. Agent configuration has not been injected; no real session is connected.' }, null, 2));
  return state;
  } finally { await rmdir(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(result => { if (result?.status === 'error') process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
