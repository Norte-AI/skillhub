import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HubStore } from '../packages/core/index.mjs';
import { publishGitMarketplace } from '../packages/git-market/index.mjs';

const execute = promisify(execFile);
async function git(args, cwd) { return (await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })).stdout.trim(); }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'skillhub-git-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new HubStore({ dataDir: join(directory, 'data') }).init();
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Review', body: 'Review safely', resources: [{ path: 'scripts/guide.sh', body: 'exit 99\n' }] });
  await store.saveContent({ id: 'execute.rule', kind: 'rule', title: 'Execute', body: 'Use confirmed scope' });
  await store.saveBundle({ id: 'personal.tools', name: 'Personal Tools', items: ['review.summary', 'execute.rule'] });
  const release = await store.buildRelease('personal.tools', '1.0.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: release.id });
  return { directory, store, release, outDir: join(directory, 'codex.git') };
}

test('publishes cloneable native Git marketplace with fixed mappings, immutable tags and no-op duplicate snapshot', async t => {
  const { directory, store, release, outDir } = await fixture(t);
  const first = await publishGitMarketplace({ store, outDir });
  assert.equal(first.status, 'published');
  assert.equal((await readdir(directory)).some(name => name.startsWith('.skillhub-repository-stage-')), false, 'destination-filesystem staging is cleaned after activation');
  assert.match(first.tag, /^snapshot-codex-[a-f0-9]{64}$/);
  assert.equal(await git(['--git-dir', outDir, 'symbolic-ref', 'HEAD']), 'refs/heads/main');
  const checkout = join(directory, 'clone');
  await git(['clone', outDir, checkout]);
  const catalog = JSON.parse(await readFile(join(checkout, '.agents/plugins/marketplace.json'), 'utf8'));
  assert.equal(catalog.name, 'skill-hub');
  assert.equal(catalog.interface.displayName, 'Skill Hub');
  assert.deepEqual(catalog.plugins[0].source, { source: 'local', path: './plugins/personal-tools' });
  assert.equal(JSON.parse(await readFile(join(checkout, 'skillhub-releases.json'), 'utf8')).plugins[0].releaseId, release.id);
  assert.match(await readFile(join(checkout, 'plugins/personal-tools/skills/review-summary/SKILL.md'), 'utf8'), /Review safely/);
  await assert.rejects(stat(join(checkout, 'AGENTS.md')), { code: 'ENOENT' });
  assert.match(await readFile(join(checkout, 'README.md'), 'utf8'), /does not automatically inject Rule/);
  const tracked = await git(['ls-files'], checkout);
  for (const forbidden of ['hub.json', 'apps/server', 'devices', 'database-url']) assert.ok(!tracked.includes(forbidden));
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Draft', body: 'Unpublished draft' });
  const unchanged = await publishGitMarketplace({ store, outDir });
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.commit, first.commit);
  assert.equal(await git(['--git-dir', outDir, 'rev-list', '--count', 'main']), '1');
  const next = await store.buildRelease('personal.tools', '1.1.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: next.id });
  const updated = await publishGitMarketplace({ store, outDir });
  assert.equal(updated.status, 'published');
  assert.notEqual(updated.commit, first.commit);
  assert.equal(await git(['--git-dir', outDir, 'rev-parse', first.tag]), first.commit);
  assert.equal(await git(['--git-dir', outDir, 'rev-list', '--count', 'main']), '2');
  await store.unpublishListing('personal.tools');
  const empty = await publishGitMarketplace({ store, outDir });
  assert.equal(empty.plugins.length, 0);
  assert.equal(JSON.parse(await git(['--git-dir', outDir, 'show', 'main:.agents/plugins/marketplace.json'])).plugins.length, 0);
  const tree = await git(['--git-dir', outDir, 'ls-tree', '-r', '--name-only', 'main']);
  assert.ok(!tree.includes('plugins/personal-tools'));
  await store.publishListing({ bundleId: 'personal.tools', releaseId: release.id });
  const restored = await publishGitMarketplace({ store, outDir });
  assert.equal(restored.snapshotDigest, first.snapshotDigest);
  assert.equal(await git(['--git-dir', outDir, 'rev-parse', first.tag]), first.commit);
  assert.equal(await git(['--git-dir', outDir, 'rev-list', '--count', 'main']), '4');
});

test('refuses unmanaged repositories, resource Git control paths and slug collisions without changing published refs', async t => {
  const { directory, store, release, outDir } = await fixture(t);
  const unmanaged = join(directory, 'unmanaged.git');
  await git(['init', '--bare', unmanaged]);
  await assert.rejects(publishGitMarketplace({ store, outDir: unmanaged }), /non-managed/);
  const first = await publishGitMarketplace({ store, outDir });
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Danger', body: 'Danger', resources: [{ path: '.GiT/config', body: 'unsafe' }] });
  const danger = await store.buildRelease('personal.tools', '1.1.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: danger.id });
  await assert.rejects(publishGitMarketplace({ store, outDir }), /control paths/);
  assert.equal(await git(['--git-dir', outDir, 'rev-parse', 'main']), first.commit);
  await store.publishListing({ bundleId: 'personal.tools', releaseId: release.id });
  await store.saveBundle({ id: 'personal_tools', name: 'Collision', items: ['execute.rule'] });
  const conflicting = await store.buildRelease('personal_tools', '1.0.0');
  await store.publishListing({ bundleId: 'personal_tools', releaseId: conflicting.id });
  await assert.rejects(publishGitMarketplace({ store, outDir }), /slug collision/);
  assert.equal(await git(['--git-dir', outDir, 'rev-parse', 'main']), first.commit);
  assert.ok(!(await readdir(directory)).some(path => path.endsWith('publish-lock')));
});

test('publication lock serializes processes and disables inherited config and bare receive hooks', async t => {
  const { directory, store, outDir } = await fixture(t);
  const first = await publishGitMarketplace({ store, outDir });
  const marker = join(directory, 'hook-executed');
  await mkdir(join(outDir, 'hooks'));
  await writeFile(join(outDir, 'hooks/pre-receive'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  await store.saveBundle({ id: 'personal.tools', name: 'Changed title', items: ['review.summary'] });
  const next = await store.buildRelease('personal.tools', '1.1.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: next.id });
  const outcomes = await Promise.allSettled([publishGitMarketplace({ store, outDir }), publishGitMarketplace({ store, outDir })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1, outcomes.filter(item => item.status === 'rejected').map(item => item.reason.message).join('\n'));
  assert.match(outcomes.find(item => item.status === 'rejected').reason.message, /locked/);
  assert.notEqual(await git(['--git-dir', outDir, 'rev-parse', 'main']), first.commit);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  await mkdir(`${outDir}.publish-lock`);
  await assert.rejects(publishGitMarketplace({ store, outDir }), /locked/);
  await rm(`${outDir}.publish-lock`, { recursive: true });
  const author = await git(['--git-dir', outDir, 'log', '-1', '--format=%an <%ae>']);
  assert.equal(author, 'Skill Hub Publisher <publisher@skillhub.local>');
});

test('forced staging retains mandatory files hidden by resource gitignore and refuses attributes before ref updates', async t => {
  const { store, outDir } = await fixture(t);
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Review', body: 'Required skill', resources: [{ path: '.gitignore', body: 'SKILL.md\nscripts/\n' }, { path: 'scripts/guide.sh', body: 'exit 99\n' }] });
  const release = await store.buildRelease('personal.tools', '1.1.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: release.id });
  const first = await publishGitMarketplace({ store, outDir });
  const tree = await git(['--git-dir', outDir, 'ls-tree', '-r', '--name-only', 'main']);
  assert.ok(tree.includes('plugins/personal-tools/skills/review-summary/SKILL.md'));
  assert.ok(tree.includes('plugins/personal-tools/skills/review-summary/scripts/guide.sh'));
  assert.equal(await git(['--git-dir', outDir, 'show', 'main:plugins/personal-tools/skills/review-summary/scripts/guide.sh']), 'exit 99');
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Review', body: 'Blocked attributes', resources: [{ path: '.GitAttributes', body: '* filter=external\n' }] });
  const blocked = await store.buildRelease('personal.tools', '1.2.0');
  await store.publishListing({ bundleId: 'personal.tools', releaseId: blocked.id });
  await assert.rejects(publishGitMarketplace({ store, outDir }), /control paths/);
  assert.equal(await git(['--git-dir', outDir, 'rev-parse', 'main']), first.commit);
});

test('publisher CLI ignores inherited global config, GIT_DIR and author variables without running configured hooks', async t => {
  const { directory } = await fixture(t);
  const hooks = join(directory, 'global-hooks');
  await mkdir(hooks);
  const marker = join(directory, 'global-hook-executed');
  await writeFile(join(hooks, 'prepare-commit-msg'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  const globalConfig = join(directory, 'global-config');
  await writeFile(globalConfig, `[core]\n hooksPath = ${hooks}\n fsmonitor = ${join(hooks, 'prepare-commit-msg')}\n[user]\n name = Inherited user\n email = inherited@example.invalid\n[commit]\n gpgsign = true\n`);
  const outDir = join(directory, 'inherited.git');
  const script = fileURLToPath(new URL('../scripts/publish-git-market.mjs', import.meta.url));
  const result = await execute(process.execPath, [script, '--data', join(directory, 'data'), '--out', outDir, '--target', 'codex'], {
    env: { ...process.env, SKILLHUB_DATABASE_URL: '', GIT_CONFIG_GLOBAL: globalConfig, GIT_DIR: join(directory, 'not-a-repository'), GIT_AUTHOR_NAME: 'Inherited user', GIT_AUTHOR_EMAIL: 'inherited@example.invalid' }, timeout: 30000,
  });
  assert.equal(JSON.parse(result.stdout).status, 'published');
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  assert.equal(await git(['--git-dir', outDir, 'log', '-1', '--format=%an <%ae>']), 'Skill Hub Publisher <publisher@skillhub.local>');
});

test('ZCode Rule-only plugin retains the manifest skills directory after Git clone', async t => {
  const { directory, store } = await fixture(t);
  await store.saveBundle({ id: 'rules.only', name: 'Rules only', targets: ['zcode'], items: ['execute.rule'] });
  const release = await store.buildRelease('rules.only', '1.0.0');
  await store.publishListing({ bundleId: 'rules.only', releaseId: release.id });
  const outDir = join(directory, 'zcode.git');
  const result = await publishGitMarketplace({ store, target: 'zcode', outDir });
  assert.equal(result.plugins.length, 2);
  const checkout = join(directory, 'zcode-clone');
  await git(['clone', outDir, checkout]);
  const catalog = JSON.parse(await readFile(join(checkout, 'marketplace.json'), 'utf8'));
  const rules = catalog.plugins.find(plugin => plugin.name === 'rules-only');
  assert.equal(rules.source, './plugins/rules-only');
  assert.equal((await stat(join(checkout, 'plugins/rules-only/skills'))).isDirectory(), true);
  assert.equal(JSON.parse(await readFile(join(checkout, 'plugins/rules-only/.zcode-plugin/plugin.json'), 'utf8')).skills, './skills/');
});
