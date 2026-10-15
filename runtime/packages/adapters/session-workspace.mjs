import { readFile, writeFile, mkdir, cp, lstat, readdir } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { exportMarketplace, skillSlug } from '../exporter/index.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const marker = '.skillhub-session.json';
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
async function manifestFiles(root, relative = '') {
  const files = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Session snapshot contains a symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await manifestFiles(root, path));
    else if (entry.isFile() && path !== marker) files.push({ path, digest: hash(await readFile(join(root, path))) });
    else if (!entry.isFile()) throw new Error(`Session snapshot contains a special file: ${path}`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifySessionWorkspace(directory) {
  const root = resolve(directory); const entry = await lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe session workspace');
  const lockEntry = await lstat(join(root, marker));
  if (!lockEntry.isFile() || lockEntry.isSymbolicLink()) throw new Error('Unsafe session lock');
  const lock = JSON.parse(await readFile(join(root, marker), 'utf8'));
  if (lock.schemaVersion !== 1 || !safeId(lock.sessionKey) || !['codex', 'kimi', 'zcode'].includes(lock.client) || !Array.isArray(lock.files)) throw new Error('Invalid session lock');
  const lockedPaths = new Set(lock.files.map(file => file.path));
  for (const controlled of ['plugins', '.agents']) {
    try { for (const file of await manifestFiles(root, controlled)) if (!lockedPaths.has(file.path)) throw new Error(`Unexpected managed session file: ${file.path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const file of lock.files) {
    if (typeof file.path !== 'string' || !file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid locked path');
    let current = root;
    for (const component of file.path.split('/')) { current = join(current, component); const info = await lstat(current); if (info.isSymbolicLink()) throw new Error(`Session snapshot path is symlinked: ${file.path}`); }
    if (hash(await readFile(current)) !== file.digest) throw new Error(`Session snapshot drift: ${file.path}`);
  }
  return { ...lock, workspace: root, status: 'verified-snapshot', loaded: false };
}
/** The caller chooses a new sessionKey for each session. A bound key can never change Release. */
export async function prepareSessionWorkspace({ release, client, sessionKey, root }) {
  if (!isAbsolute(root ?? '')) throw new Error('An explicit absolute session root is required');
  if (!safeId(sessionKey)) throw new Error('sessionKey must be a safe lowercase identifier');
  if (!release?.id || !release.digest) throw new Error('A fixed Release is required');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootEntry = await lstat(root); if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error('Unsafe session root');
  const directory = join(root, sessionKey);
  try {
    const existing = await verifySessionWorkspace(directory);
    if (existing.releaseId !== release.id || existing.releaseDigest !== release.digest || existing.client !== client || existing.sessionKey !== sessionKey) throw new Error('Session is already bound to a different Release or client');
    return existing;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const name = `${skillSlug(release.bundleId).slice(0, 51).replace(/-$/, '')}-${release.digest.slice(0, 12)}`;
  const exported = await exportMarketplace({ release, target: client, outDir: directory, pluginName: name });
  if (client === 'codex') await cp(join(directory, 'plugins', name, 'skills'), join(directory, '.agents/skills'), { recursive: true });
  const files = await manifestFiles(directory);
  const lock = { schemaVersion: 1, sessionKey, client, releaseId: release.id, releaseDigest: release.digest, artifactDigest: exported.sourceDigest, pluginName: name, files, createdAt: new Date().toISOString(), nativeLoading: client === 'codex' ? 'project-skills-and-AGENTS' : client === 'zcode' ? 'project-scoped-native-plugin-and-AGENTS' : 'release-specific-desktop-plugin', loaded: false };
  await writeFile(join(directory, marker), `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { ...lock, workspace: directory, status: 'prepared-snapshot' };
}
