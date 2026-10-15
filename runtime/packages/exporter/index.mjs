import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { digest } from '../core/index.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
function slug(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value.includes('..')) throw new Error('Unsafe plugin or content identifier');
  return value;
}
function safePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0') || /^[a-zA-Z]:/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe resource path');
  return value;
}
export function skillSlug(sourceId) {
  slug(sourceId);
  let value = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (value.length > 64) value = `${value.slice(0, 55).replace(/-$/, '')}-${sha(sourceId).slice(0, 8)}`;
  return value;
}
function nativeSkillName(item) {
  const provenance = item.resources.find(resource => resource.path === '.skillhub-registry.json');
  if (!provenance) return skillSlug(item.id);
  let source;
  try { source = JSON.parse(provenance.body); } catch { throw new Error('Invalid Registry provenance for native Skill'); }
  if (typeof source.namespace !== 'string' || typeof source.slug !== 'string' || typeof source.version !== 'string' || !/^[a-f0-9]{64}$/.test(source.packageSha256 ?? '')) throw new Error('Invalid Registry provenance for native Skill');
  // Registry content IDs identify immutable source packages. The native Skill
  // must retain the source's declared name rather than its hashed storage ID.
  const match = item.body.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/);
  const names = match?.[1].split('\n').filter(line => /^name\s*:/.test(line)) ?? [];
  if (names.length !== 1) throw new Error('Registry Skill requires exactly one native frontmatter name');
  let name = names[0].replace(/^name\s*:\s*/, '').trim();
  if (name.startsWith('"')) { try { name = JSON.parse(name); } catch { throw new Error('Invalid Registry Skill name'); } }
  else if (name.startsWith("'")) { if (!name.endsWith("'")) throw new Error('Invalid Registry Skill name'); name = name.slice(1, -1).replace(/''/g, "'"); }
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Invalid Registry Skill name');
  return name;
}
function skillBody(item, name) {
  // Parse conventional LF/CRLF frontmatter without rewriting source bytes.
  const parsedBody = item.body.replace(/\r\n/g, '\n');
  if (!parsedBody.startsWith('---\n')) return `---\nname: ${name}\ndescription: ${JSON.stringify(item.title)}\n---\n\n${item.body}`;
  const end = parsedBody.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Invalid Skill frontmatter for ${item.id}: missing closing delimiter`);
  const names = parsedBody.slice(4, end).split('\n').filter(line => /^name\s*:/.test(line));
  if (names.length !== 1) throw new Error(`Invalid Skill frontmatter for ${item.id}: exactly one name is required`);
  if (!/^description:\s*\S+/m.test(parsedBody.slice(4, end))) throw new Error(`Invalid Skill frontmatter for ${item.id}: description is required`);
  let declared = names[0].replace(/^name\s*:\s*/, '').trim();
  if (declared.startsWith('"')) {
    try { declared = JSON.parse(declared); } catch { throw new Error(`Invalid Skill frontmatter name for ${item.id}`); }
  } else if (declared.startsWith("'")) {
    if (!declared.endsWith("'")) throw new Error(`Invalid Skill frontmatter name for ${item.id}`);
    declared = declared.slice(1, -1).replace(/''/g, "'");
  }
  if (typeof declared !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(declared) || declared.length > 64 || declared !== name) throw new Error(`Skill frontmatter name for ${item.id} must match the native output slug ${name}`);
  return item.body;
}

/** Exports a fixed immutable Release into a NEW isolated workspace; never executes resources. */
export async function exportMarketplace({ release, target, outDir, pluginName: requestedPluginName }) {
  if (!['codex', 'zcode', 'kimi'].includes(target)) throw new Error('Unsupported native marketplace target');
  if (typeof outDir !== 'string' || !outDir) throw new Error('outDir is required');
  const bundleId = slug(release?.bundleId);
  const pluginName = requestedPluginName ?? skillSlug(bundleId);
  if (typeof pluginName !== 'string' || pluginName.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pluginName)) throw new Error('Native plugin name must be a safe kebab-case identifier up to 64 characters');
  if (!release.id || typeof release.version !== 'string' || release.id !== `${bundleId}@${release.version}`) throw new Error('A fixed Release is required');
  const artifact = release.artifacts?.[target];
  if (typeof artifact?.content !== 'string' || artifact.manifest?.releaseId !== release.id || artifact.manifest.target !== target || artifact.manifest.bundleId !== bundleId || artifact.manifest.version !== release.version || artifact.manifest.digest !== sha(artifact.content)) throw new Error('Release artifact identity or digest mismatch');
  const content = JSON.parse(artifact.content);
  if (!Array.isArray(content) || !Array.isArray(release.items) || content.length !== release.items.length) throw new Error('Invalid locked content');
  if (release.status !== 'ready' || digest({ schemaVersion: 1, bundle: release.bundle, content }) !== release.digest) throw new Error('Release payload digest mismatch');
  const files = new Map();
  const plugin = `plugins/${pluginName}`;
  function add(path, body) {
    safePath(path);
    if (typeof body !== 'string') throw new Error('Resource body must be a string');
    const key = path.normalize('NFC').toLowerCase();
    for (const existing of files.keys()) if (existing === key || existing.startsWith(`${key}/`) || key.startsWith(`${existing}/`)) throw new Error(`Output path collision: ${path}`);
    files.set(key, { path, body });
  }
  const rules = [];
  const seen = new Set();
  const skills = [];
  const skillNames = new Set();
  for (const [index, item] of content.entries()) {
    slug(item.id);
    if (seen.has(item.id)) throw new Error('Duplicate content id');
    seen.add(item.id);
    if (!['rule', 'role', 'skill'].includes(item.kind) || typeof item.title !== 'string' || typeof item.body !== 'string' || !Array.isArray(item.resources)) throw new Error('Invalid content');
    const locked = release.items[index];
    const { revision, digest: contentDigest, ...payload } = item;
    if (locked.id !== item.id || locked.revision !== revision || locked.digest !== contentDigest || digest(payload) !== contentDigest) throw new Error('Locked revision digest mismatch');
    const name = item.kind === 'skill' ? nativeSkillName(item) : item.id;
    if (item.kind === 'skill') {
      if (skillNames.has(name)) throw new Error(`Native Skill slug collision: ${name}`);
      skillNames.add(name);
      skills.push({ sourceId: item.id, name, path: `${plugin}/skills/${name}` });
    }
    const directory = item.kind === 'skill' ? `${plugin}/skills/${name}` : `${plugin}/references/${item.kind}s/${item.id}`;
    if (item.kind === 'skill') {
      // Retain frontmatter only after its native name matches the output directory.
      const body = skillBody(item, name);
      add(`${directory}/SKILL.md`, `${body}\n`);
    } else {
      add(`${directory}/content.md`, `# ${item.title}\n\n${item.body}\n`);
      if (item.kind === 'rule') rules.push(`## ${item.title}\n\n${item.body}`);
    }
    for (const resource of item.resources) add(`${directory}/${safePath(resource?.path)}`, resource.body);
  }
  add('AGENTS.md', `# Skill Hub experimental workspace\n\nFixed release: ${release.id}\n\nThese rules belong to this isolated workspace. Plugin installation alone does not establish automatic Rule injection.\n\n${rules.join('\n\n')}\n`);
  const rulesBody = `${rules.join('\n\n')}\n`;
  if (target === 'kimi' && rules.length && Buffer.byteLength(rulesBody, 'utf8') > 32 * 1024) throw new Error('Kimi desktop RULES.md exceeds the 32 KiB systemPromptPath limit');
  const manifest = target === 'kimi'
    ? { name: pluginName, version: release.version, interface: { displayName: release.bundle.name, category: 'PRODUCTIVITY' }, skills: './skills/', ...(rules.length ? { systemPromptPath: './RULES.md' } : {}) }
    : { name: pluginName, version: release.version, description: release.bundle?.description || release.bundle?.name || bundleId, skills: './skills/' };
  if (target === 'kimi' && rules.length) add(`${plugin}/RULES.md`, rulesBody);
  add(target === 'kimi' ? `${plugin}/kimi.plugin.json` : `${plugin}/.${target}-plugin/plugin.json`, json(manifest));
  const marketplace = target === 'codex'
    ? { name: `skill-hub-${pluginName}`, plugins: [{ name: pluginName, source: { source: 'local', path: `./${plugin}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }
    : target === 'zcode' ? { name: `skill-hub-${pluginName}`, plugins: [{ name: pluginName, source: `./${plugin}`, version: release.version }] }
      : { schemaVersion: 1, kind: 'skillhub-builder-input-index', target: 'kimi-desktop', name: `skill-hub-${pluginName}`, plugins: [{ name: pluginName, directory: `./${plugin}`, manifest: `./${plugin}/kimi.plugin.json`, releaseId: release.id, version: release.version }], note: 'Generic local builder input index. Desktop marketplace registration and installation have not been performed.' };
  add(target === 'codex' ? '.agents/plugins/marketplace.json' : 'marketplace.json', json(marketplace));
  const metadata = { schemaVersion: 1, releaseId: release.id, bundleId, pluginName, version: release.version, target, sourceDigest: artifact.manifest.digest, status: 'exported-unverified', ruleInjection: target === 'kimi' ? 'desktop-plugin-systemPromptPath-unverified' : 'isolated-workspace-AGENTS.md-only', skills, files: [...files.values()].map(({ path, body }) => ({ path, digest: sha(body) })) };
  add('skillhub-export.json', json(metadata));
  const directory = resolve(outDir);
  // Exclusive directory creation rejects existing directories, files and symlinks.
  await mkdir(directory);
  try {
    await mkdir(join(directory, plugin, 'skills'), { recursive: true });
    for (const { path, body } of files.values()) {
      const destination = join(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, body, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { ...metadata, outDir: directory };
}
