import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HubStore, digest, canonicalJson } from '../packages/core/index.mjs';
import { exportMarketplace, skillSlug } from '../packages/exporter/index.mjs';

async function fixture(t, resources = [{ path: 'scripts/example.sh', body: 'exit 99\n' }, { path: 'references/guide.md', body: 'Guide' }]) {
  const directory = await mkdtemp(join(tmpdir(), 'skillhub-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new HubStore({ dataDir: join(directory, 'data') }).init();
  await store.saveContent({ id: 'workflow', kind: 'skill', title: 'A workflow', body: 'Follow this workflow.', resources });
  await store.saveContent({ id: 'reviewer', kind: 'role', title: 'Reviewer', body: 'Review carefully.' });
  await store.saveContent({ id: 'execute', kind: 'rule', title: 'Execution', body: 'Execute confirmed scope.' });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['workflow', 'reviewer', 'execute'] });
  return { directory, release: await store.buildRelease('personal', '1.0.0'), store };
}

test('exports fixed release into Codex and ZCode native manifests including hidden paths', async t => {
  const { directory, release, store } = await fixture(t);
  await store.saveContent({ id: 'workflow', kind: 'skill', title: 'Changed', body: 'Draft only' });
  for (const target of ['codex', 'zcode']) {
    const output = join(directory, target);
    const result = await exportMarketplace({ release, target, outDir: output });
    assert.equal(result.releaseId, 'personal@1.0.0');
    assert.equal(result.status, 'exported-unverified');
    const marketplace = JSON.parse(await readFile(join(output, target === 'codex' ? '.agents/plugins/marketplace.json' : 'marketplace.json'), 'utf8'));
    assert.equal(marketplace.plugins[0].name, 'personal');
    assert.deepEqual(marketplace.plugins[0].source, target === 'codex' ? { source: 'local', path: './plugins/personal' } : './plugins/personal');
    const manifest = JSON.parse(await readFile(join(output, `plugins/personal/.${target}-plugin/plugin.json`), 'utf8'));
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.skills, './skills/');
    const skill = await readFile(join(output, 'plugins/personal/skills/workflow/SKILL.md'), 'utf8');
    assert.match(skill, /name: workflow/);
    assert.match(skill, /Follow this workflow/);
    assert.doesNotMatch(skill, /Draft only/);
    assert.equal(await readFile(join(output, 'plugins/personal/skills/workflow/scripts/example.sh'), 'utf8'), 'exit 99\n');
    assert.equal((await stat(join(output, 'plugins/personal/skills/workflow/scripts/example.sh'))).mode & 0o111, 0);
    assert.match(await readFile(join(output, 'plugins/personal/references/roles/reviewer/content.md'), 'utf8'), /Review carefully/);
    const rules = await readFile(join(output, 'AGENTS.md'), 'utf8');
    assert.match(rules, /Execute confirmed scope/);
    assert.match(rules, /does not establish automatic Rule injection/);
    assert.equal(JSON.parse(await readFile(join(output, 'skillhub-export.json'), 'utf8')).sourceDigest, release.artifacts[target].manifest.digest);
    await assert.rejects(exportMarketplace({ release, target, outDir: output }), { code: 'EEXIST' });
    assert.equal(await readFile(join(output, 'AGENTS.md'), 'utf8'), rules);
  }
});

test('rejects generated Skill collisions and file/directory resource collisions before writing', async t => {
  for (const resources of [[{ path: 'SKILL.md', body: 'overwrite' }], [{ path: 'skill.md', body: 'case-insensitive overwrite' }], [{ path: 'guide', body: 'file' }, { path: 'guide/reference.md', body: 'nested' }]]) {
    const { directory, release } = await fixture(t, resources);
    const output = join(directory, 'blocked');
    await assert.rejects(exportMarketplace({ release, target: 'codex', outDir: output }), /collision/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});

test('rejects corrupted sources, unknown target, channel refs and existing files or symlinks', async t => {
  const { directory, release } = await fixture(t);
  const output = join(directory, 'blocked');
  await assert.rejects(exportMarketplace({ release, target: 'unknown', outDir: output }), /Unsupported/);
  await assert.rejects(exportMarketplace({ release: { ...release, id: 'stable' }, target: 'codex', outDir: output }), /fixed Release/);
  const corrupted = structuredClone(release);
  corrupted.artifacts.codex.content += ' ';
  await assert.rejects(exportMarketplace({ release: corrupted, target: 'codex', outDir: output }), /digest mismatch/);
  await writeFile(output, 'preserve');
  await assert.rejects(exportMarketplace({ release, target: 'codex', outDir: output }), { code: 'EEXIST' });
  assert.equal(await readFile(output, 'utf8'), 'preserve');
  const link = join(directory, 'link');
  await symlink(directory, link);
  await assert.rejects(exportMarketplace({ release, target: 'codex', outDir: link }), { code: 'EEXIST' });
  assert.deepEqual((await readdir(directory)).sort(), ['blocked', 'data', 'link']);
});

test('resource paths are independently validated even when all source digests match', async t => {
  const { directory, release } = await fixture(t);
  for (const path of ['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a/./b', 'a//b', 'a\0b']) {
    const source = structuredClone(release);
    const content = JSON.parse(source.artifacts.codex.content);
    content[0].resources = [{ path, body: 'unsafe' }];
    const { revision, digest: previousDigest, ...payload } = content[0];
    content[0].digest = digest(payload);
    source.items[0].digest = content[0].digest;
    source.artifacts.codex.content = canonicalJson(content);
    source.artifacts.codex.manifest.digest = createHash('sha256').update(source.artifacts.codex.content).digest('hex');
    source.digest = digest({ schemaVersion: 1, bundle: source.bundle, content });
    await assert.rejects(exportMarketplace({ release: source, target: 'codex', outDir: join(directory, 'blocked') }), /Unsafe resource path/);
    await assert.rejects(stat(join(directory, 'blocked')), { code: 'ENOENT' });
  }
});

test('native Skill names use stable legal slugs with source identity and reject collisions', async t => {
  const { directory, store } = await fixture(t);
  const longId = `review.${'a'.repeat(100)}`;
  for (const id of ['review.summary', longId]) await store.saveContent({ id, kind: 'skill', title: 'Review', body: 'Review the proposal.' });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['review.summary', longId] });
  const release = await store.buildRelease('personal', '2.0.0');
  const result = await exportMarketplace({ release, target: 'codex', outDir: join(directory, 'slugs') });
  assert.equal(result.skills[0].name, 'review-summary');
  assert.equal(result.skills[0].sourceId, 'review.summary');
  for (const skill of result.skills) {
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(skill.name.length <= 64);
    assert.equal(skill.name, skillSlug(skill.sourceId));
    assert.match(await readFile(join(directory, 'slugs', skill.path, 'SKILL.md'), 'utf8'), new RegExp(`name: ${skill.name}`));
  }
  assert.match(result.skills[1].name, /-[0-9a-f]{8}$/);
  await store.saveContent({ id: 'review_summary', kind: 'skill', title: 'Other', body: 'Other review.' });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['review.summary', 'review_summary'] });
  const conflicting = await store.buildRelease('personal', '2.1.0');
  await assert.rejects(exportMarketplace({ release: conflicting, target: 'zcode', outDir: join(directory, 'collision') }), /slug collision/);
  await assert.rejects(stat(join(directory, 'collision')), { code: 'ENOENT' });
});

test('existing Skill frontmatter must declare exactly the native output name', async t => {
  const { directory, store } = await fixture(t);
  const valid = '---\nname: review-summary\ndescription: Keep this text\ncustom: preserved\n---\n\nReview.';
  await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Review', body: valid });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['review.summary'] });
  const release = await store.buildRelease('personal', '3.0.0');
  await exportMarketplace({ release, target: 'codex', outDir: join(directory, 'valid') });
  assert.equal(await readFile(join(directory, 'valid/plugins/personal/skills/review-summary/SKILL.md'), 'utf8'), `${valid}\n`);
  const invalid = ['---\nname: review.summary\ndescription: Test\n---\nBody', '---\nname: wrong-name\ndescription: Test\n---\nBody', '---\nname: review-summary\nname: review-summary\n---\nBody', '---\ndescription: missing name\n---\nBody', '---\nname: review-summary\nBody', '---\nname: review-summary\n---\nBody'];
  for (const [index, body] of invalid.entries()) {
    await store.saveContent({ id: 'review.summary', kind: 'skill', title: 'Review', body });
    const bad = await store.buildRelease('personal', `3.0.${index + 1}`);
    await assert.rejects(exportMarketplace({ release: bad, target: 'codex', outDir: join(directory, `invalid-${index}`) }), /frontmatter/);
    await assert.rejects(stat(join(directory, `invalid-${index}`)), { code: 'ENOENT' });
  }
});

test('Kimi desktop exports builder input, systemPromptPath rules and stable plugin slug without automatic hooks', async t => {
  const { directory, store } = await fixture(t);
  await store.saveBundle({ id: 'personal.rules', name: 'Desktop Personal', items: ['workflow', 'reviewer', 'execute'] });
  const release = await store.buildRelease('personal.rules', '1.0.0');
  const output = join(directory, 'kimi-desktop');
  const result = await exportMarketplace({ release, target: 'kimi', outDir: output });
  assert.equal(result.bundleId, 'personal.rules');
  assert.equal(result.pluginName, 'personal-rules');
  assert.equal(result.status, 'exported-unverified');
  assert.equal(result.ruleInjection, 'desktop-plugin-systemPromptPath-unverified');
  const manifest = JSON.parse(await readFile(join(output, 'plugins/personal-rules/kimi.plugin.json'), 'utf8'));
  assert.deepEqual(manifest, { name: 'personal-rules', version: '1.0.0', interface: { displayName: 'Desktop Personal', category: 'PRODUCTIVITY' }, skills: './skills/', systemPromptPath: './RULES.md' });
  assert.equal(Object.hasOwn(manifest, 'sessionStart'), false);
  assert.equal(Object.hasOwn(manifest, 'hooks'), false);
  assert.match(await readFile(join(output, 'plugins/personal-rules/RULES.md'), 'utf8'), /Execute confirmed scope/);
  assert.match(await readFile(join(output, 'plugins/personal-rules/references/roles/reviewer/content.md'), 'utf8'), /Review carefully/);
  const index = JSON.parse(await readFile(join(output, 'marketplace.json'), 'utf8'));
  assert.equal(index.kind, 'skillhub-builder-input-index');
  assert.equal(index.target, 'kimi-desktop');
  assert.equal(Object.hasOwn(index.plugins[0], 'source'), false);
  assert.equal(index.plugins[0].directory, './plugins/personal-rules');
});

test('Kimi desktop omits systemPromptPath without Rules and checks UTF8 32 KiB limit before writing', async t => {
  const { directory, store } = await fixture(t);
  const longBundleId = `desktop.${'a'.repeat(100)}`;
  await store.saveBundle({ id: longBundleId, name: 'Skills only', items: ['workflow'] });
  const release = await store.buildRelease(longBundleId, '1.0.0');
  const output = join(directory, 'no-rules');
  const result = await exportMarketplace({ release, target: 'kimi', outDir: output });
  assert.ok(result.pluginName.length <= 64);
  assert.match(result.pluginName, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const manifest = JSON.parse(await readFile(join(output, `plugins/${result.pluginName}/kimi.plugin.json`), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'systemPromptPath'), false);
  await assert.rejects(stat(join(output, `plugins/${result.pluginName}/RULES.md`)), { code: 'ENOENT' });
  await store.saveContent({ id: 'execute', kind: 'rule', title: 'Rule', body: 'a'.repeat(32758) });
  const atLimit = await store.buildRelease('personal', '1.0.1');
  const limitOutput = join(directory, 'at-limit');
  await exportMarketplace({ release: atLimit, target: 'kimi', outDir: limitOutput });
  assert.equal((await stat(join(limitOutput, 'plugins/personal/RULES.md'))).size, 32 * 1024);
  await store.saveContent({ id: 'execute', kind: 'rule', title: 'Rule', body: '中'.repeat(10923) });
  const tooLarge = await store.buildRelease('personal', '1.1.0');
  await assert.rejects(exportMarketplace({ release: tooLarge, target: 'kimi', outDir: join(directory, 'too-large') }), /32 KiB/);
  await assert.rejects(stat(join(directory, 'too-large')), { code: 'ENOENT' });
});

test('session-specific plugin identifiers separate native caches and reject unsafe overrides',async t=>{
 const {directory,release}=await fixture(t);
 const result=await exportMarketplace({release,target:'kimi',outDir:join(directory,'session-plugin'),pluginName:'personal-abc123'});
 assert.equal(result.pluginName,'personal-abc123');
 const manifest=JSON.parse(await readFile(join(directory,'session-plugin/plugins/personal-abc123/kimi.plugin.json'),'utf8'));
 assert.equal(manifest.name,'personal-abc123');
 for(const pluginName of ['../escape','Bad.Name','x'.repeat(65),''])await assert.rejects(exportMarketplace({release,target:'codex',outDir:join(directory,'invalid-name'),pluginName}),/safe kebab-case/);
});

test('Registry-imported immutable content keeps original native Skill name and exact resources across targets',async t=>{
 const {directory,store}=await fixture(t);const id='registry-84f54fc2bc306ebdabc44284bb86c96b375fdce3';
 const body='---\nname: weather\ndescription: Weather lookup\n---\nRead references/weather.md';
 const resources=[{path:'references/weather.md',body:'Source weather resource'},{path:'.skillhub-registry.json',body:JSON.stringify({namespace:'global',slug:'weather',version:'1.0.0',packageSha256:'a'.repeat(64)})}];
 await store.saveContent({id,kind:'skill',title:'Weather',body,resources});await store.saveBundle({id:'imported',name:'Imported registry bundle',items:[id]});const release=await store.buildRelease('imported','1.0.0');
 for(const target of ['codex','zcode','kimi']){const outDir=join(directory,'registry-'+target);const exported=await exportMarketplace({release,target,outDir});assert.equal(exported.skills[0].sourceId,id);assert.equal(exported.skills[0].name,'weather');assert.equal(await readFile(join(outDir,'plugins/imported/skills/weather/SKILL.md'),'utf8'),body+'\n');assert.equal(await readFile(join(outDir,'plugins/imported/skills/weather/.skillhub-registry.json'),'utf8'),resources[1].body);}
 await store.saveContent({id:'weather',kind:'skill',title:'Other weather',body:'Other content'});await store.saveBundle({id:'collision',name:'Conflict',items:[id,'weather']});const conflicting=await store.buildRelease('collision','1.0.0');await assert.rejects(exportMarketplace({release:conflicting,target:'codex',outDir:join(directory,'registry-collision')}),/slug collision/);
});

test('CRLF Registry Skill frontmatter is parsed once while original body bytes remain unchanged',async t=>{
 const {directory,store}=await fixture(t);const body='---\r\nname: weather\r\ndescription: CRLF weather\r\n---\r\nRead references/weather.md\r\n';
 await store.saveContent({id:'registry-crlf',kind:'skill',title:'CRLF weather',body,resources:[{path:'.skillhub-registry.json',body:JSON.stringify({namespace:'global',slug:'weather',version:'1.0.0',packageSha256:'b'.repeat(64)})}]});
 await store.saveBundle({id:'crlf',name:'CRLF imported',items:['registry-crlf']});const release=await store.buildRelease('crlf','1.0.0');
 // Core authoring normalizes line endings; construct a valid locked CRLF source
 // to independently exercise exporter compatibility with externally imported snapshots.
 const content=JSON.parse(release.artifacts.codex.content);content[0].body=body;
 const {revision,digest:previousDigest,...payload}=content[0];content[0].digest=digest(payload);release.items[0].digest=content[0].digest;
 release.digest=digest({schemaVersion:1,bundle:release.bundle,content});
 for(const artifact of Object.values(release.artifacts)){artifact.content=canonicalJson(content);artifact.manifest.digest=createHash('sha256').update(artifact.content).digest('hex');}

 for(const target of ['codex','kimi','zcode']){const outDir=join(directory,'crlf-'+target);await exportMarketplace({release,target,outDir});const result=await readFile(join(outDir,'plugins/crlf/skills/weather/SKILL.md'),'utf8');assert.equal(result,body+'\n');assert.equal((result.match(/name: weather/g)??[]).length,1);}
});
