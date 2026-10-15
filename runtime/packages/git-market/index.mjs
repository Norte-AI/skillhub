import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat, cp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from '../core/index.mjs';
import { exportMarketplace } from '../exporter/index.mjs';

const markerName = '.skillhub-market-managed.json';
const textJson = value => `${JSON.stringify(value, null, 2)}\n`;
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function gitRunner(temporary) {
  const settings = { 'core.hooksPath': '/dev/null', 'core.fsmonitor': 'false', 'commit.gpgsign': 'false', 'tag.gpgsign': 'false', 'init.templateDir': '', 'gc.auto': '0', 'maintenance.auto': 'false', 'protocol.ext.allow': 'never', 'protocol.file.allow': 'always' };
  // Discard inherited GIT_* variables and user Git configuration. The same
  // controlled local Git processes all receive this environment. Publication
  // uses update-ref rather than receive-pack, which drops config environment.
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: temporary, TMPDIR: temporary, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(Object.keys(settings).length), GIT_AUTHOR_NAME: 'Skill Hub Publisher', GIT_AUTHOR_EMAIL: 'publisher@skillhub.local', GIT_COMMITTER_NAME: 'Skill Hub Publisher', GIT_COMMITTER_EMAIL: 'publisher@skillhub.local' };
  Object.entries(settings).forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  return async (args, cwd = temporary, input) => new Promise((resolveCommand, reject) => {
    const child = execFile('git', args, { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: 30000 }, (error, stdout) => error ? reject(error) : resolveCommand(stdout.trim()));
    child.stdin.on('error', () => {}); // Command failure is reported by its callback.
    child.stdin.end(input);
  });
}
async function fileDigests(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (['.git', '.gitmodules', '.gitattributes'].includes(entry.name.toLowerCase())) throw new Error('Git control paths are forbidden inside marketplace resources');
    if (entry.isDirectory()) files.push(...await fileDigests(directory, path));
    else if (entry.isFile()) files.push({ path, digest: createHash('sha256').update(await readFile(join(directory, path))).digest('hex') });
    else throw new Error('Git marketplace snapshot cannot contain symbolic links or special files');
  }
  return files;
}

/** Publishes only native plugin files to a managed LOCAL bare Git repository. */
export async function publishGitMarketplace({ store, target = 'codex', outDir = `.skillhub-git/${target}.git` } = {}) {
  if (!['codex', 'zcode'].includes(target)) throw new Error('Git marketplace target must be codex or zcode');
  if (!store || typeof store.listListings !== 'function' || typeof store.getRelease !== 'function') throw new Error('An initialized Skill Hub store is required');
  const repository = resolve(outDir);
  await mkdir(dirname(repository), { recursive: true });
  const lock = `${repository}.publish-lock`;
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('Git marketplace publication is already locked; retry after the current publisher completes'); throw error; }
  let temporary;
  let repositoryStaging;
  try {
    temporary = await mkdtemp(join(tmpdir(), 'skillhub-git-market-'));
    const git = gitRunner(temporary);
    const destination = await exists(repository);
    if (destination) {
      if (!destination.isDirectory() || destination.isSymbolicLink()) throw new Error('Refusing to overwrite a non-managed Git repository');
      let marker;
      try { marker = JSON.parse(await readFile(join(repository, markerName), 'utf8')); } catch { throw new Error('Refusing to overwrite a non-managed Git repository'); }
      if (marker.schemaVersion !== 1 || marker.kind !== 'skillhub-local-marketplace' || marker.target !== target || await git(['--git-dir', repository, 'rev-parse', '--is-bare-repository']) !== 'true') throw new Error('Refusing to overwrite a non-managed Git repository');
    }
    const listings = (await store.listListings()).filter(listing => listing.targets.includes(target)).sort((a, b) => a.bundleId.localeCompare(b.bundleId, 'en'));
    const snapshot = join(temporary, 'snapshot');
    await mkdir(snapshot);
    const plugins = [];
    const names = new Set();
    for (const [index, listing] of listings.entries()) {
      const release = await store.getRelease(listing.releaseId);
      if (release.bundleId !== listing.bundleId) throw new Error('Listing release does not belong to its bundle');
      const exportedDirectory = join(temporary, `export-${index}`);
      const exported = await exportMarketplace({ release, target, outDir: exportedDirectory });
      if (names.has(exported.pluginName)) throw new Error(`Marketplace plugin slug collision: ${exported.pluginName}`);
      names.add(exported.pluginName);
      await mkdir(join(snapshot, 'plugins'), { recursive: true });
      await cp(join(exportedDirectory, 'plugins', exported.pluginName), join(snapshot, 'plugins', exported.pluginName), { recursive: true, errorOnExist: true, force: false });
      const skillsDirectory = join(snapshot, 'plugins', exported.pluginName, 'skills');
      if (!(await readdir(skillsDirectory)).length) await writeFile(join(skillsDirectory, '.gitkeep'), '');
      plugins.push({ bundleId: listing.bundleId, name: exported.pluginName, releaseId: release.id, version: release.version, digest: release.digest });
    }
    const catalog = { name: 'skill-hub', interface: { displayName: 'Skill Hub' }, plugins: plugins.map(plugin => target === 'codex'
      ? { name: plugin.name, source: { source: 'local', path: `./plugins/${plugin.name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }
      : { name: plugin.name, source: `./plugins/${plugin.name}`, version: plugin.version }) };
    const catalogPath = target === 'codex' ? '.agents/plugins/marketplace.json' : 'marketplace.json';
    await mkdir(dirname(join(snapshot, catalogPath)), { recursive: true });
    await writeFile(join(snapshot, catalogPath), textJson(catalog));
    await writeFile(join(snapshot, 'README.md'), `# Skill Hub\n\nThis ${target} marketplace contains fixed releases of published plugins.\n\nPlugin installation does not automatically inject Rule content into a user project. Rules and roles are available as plugin references. No project AGENTS.md is published or overwritten. Actual client loading remains unverified.\n\nSee skillhub-releases.json for immutable release mappings.\n`);
    const files = await fileDigests(snapshot);
    const snapshotDigest = digest({ target, plugins, files });
    const tag = `snapshot-${target}-${snapshotDigest}`;
    await writeFile(join(snapshot, 'skillhub-releases.json'), textJson({ schemaVersion: 1, target, snapshotDigest, plugins }));
    let head;
    if (destination) {
      try { head = await git(['--git-dir', repository, 'rev-parse', '--verify', 'refs/heads/main']); } catch { /* A managed repository may still be empty. */ }
      if (head) {
        const current = JSON.parse(await git(['--git-dir', repository, 'show', 'refs/heads/main:skillhub-releases.json']));
        if (current.snapshotDigest === snapshotDigest) return { repository, target, snapshotDigest, tag, commit: head, status: 'unchanged', plugins };
      }
    }
    // All exporter validation completes before creating a repo or changing refs.
    if (!destination) {
      // Bare repository activation must stay on its destination filesystem (Docker
      // persistent volumes commonly differ from the process /tmp filesystem).
      repositoryStaging = await mkdtemp(join(dirname(repository), '.skillhub-repository-stage-'));
      const stagedBare = join(repositoryStaging, 'market.git');
      await git(['init', '--bare', '--initial-branch=main', stagedBare]);
      await writeFile(join(stagedBare, markerName), textJson({ schemaVersion: 1, kind: 'skillhub-local-marketplace', target }));
      await rename(stagedBare, repository);
    }
    let existingTag;
    try { existingTag = await git(['--git-dir', repository, 'rev-parse', '--verify', `refs/tags/${tag}`]); } catch { /* New immutable snapshot tag. */ }
    if (existingTag) {
      const previous = JSON.parse(await git(['--git-dir', repository, 'show', `${tag}:skillhub-releases.json`]));
      if (previous.snapshotDigest !== snapshotDigest) throw new Error('Existing snapshot tag does not match its digest; refusing to overwrite');
    }
    await git(['init', '--initial-branch=main', snapshot]);
    if (head) {
      await git(['fetch', '--no-tags', repository, 'refs/heads/main'], snapshot);
      await git(['update-ref', 'refs/heads/main', 'FETCH_HEAD'], snapshot);
    }
    await git(['add', '--force', '--all', '--', '.'], snapshot);
    await git(['commit', '-m', `Publish ${target} marketplace ${snapshotDigest}`], snapshot);
    const commit = await git(['rev-parse', 'HEAD'], snapshot);
    // Copy validated objects without touching refs. An atomic local ref
    // transaction then compares the old main and creates an immutable tag.
    // This avoids invoking bare repository receive hooks or external push.
    await git(['--git-dir', repository, 'fetch', '--no-tags', '--no-write-fetch-head', '--no-auto-maintenance', snapshot, 'refs/heads/main']);
    const commands = ['start', head ? `update refs/heads/main ${commit} ${head}` : `create refs/heads/main ${commit}`];
    if (!existingTag) commands.push(`create refs/tags/${tag} ${commit}`);
    commands.push('prepare', 'commit');
    await git(['--git-dir', repository, 'update-ref', '--stdin'], temporary, `${commands.join('\n')}\n`);
    return { repository, target, snapshotDigest, tag, commit, status: 'published', plugins };
  } finally {
    if (repositoryStaging) await rm(repositoryStaging, { recursive: true, force: true });
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
