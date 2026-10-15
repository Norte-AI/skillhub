import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HubStore } from '../packages/core/index.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-core-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await new HubStore({ dataDir }).init();
  await store.saveContent({ id: 'collaboration', kind: 'rule', title: '协作', body: '确认后执行' });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['collaboration'] });
  return { store, dataDir };
}

test('published revisions survive draft edits, caller mutation and reopening', async t => {
  const { store, dataDir } = await fixture(t);
  const first = await store.buildRelease('personal', '1.0.0');
  const artifact = await store.getArtifact(first.id, 'codex');
  first.items[0].revision = 100;
  await store.saveContent({ id: 'collaboration', kind: 'rule', title: '协作', body: '新的正文' });
  await store.saveBundle({ id: 'personal', name: 'Renamed', items: ['collaboration'] });
  const reopened = await new HubStore({ dataDir }).init();
  assert.deepEqual(await reopened.getArtifact(first.id, 'codex'), artifact);
  assert.equal((await reopened.getRelease(first.id)).items[0].revision, 1);
  assert.equal(JSON.parse(artifact.content)[0].body, '确认后执行');
  assert.equal((await reopened.getRelease(first.id)).bundle.name, 'Personal');
});

test('channel update and rollback preserve both immutable releases', async t => {
  const { store, dataDir } = await fixture(t);
  const old = await store.buildRelease('personal', '1.0.0');
  await store.setChannel('personal', 'stable', old.id);
  await store.saveContent({ id: 'collaboration', kind: 'rule', title: '协作', body: '更新' });
  const next = await store.buildRelease('personal', '1.1.0');
  await store.setChannel('personal', 'stable', next.id);
  assert.equal((await store.resolveRelease('personal')).id, next.id);
  const rollback = await store.setChannel('personal', 'stable', old.id);
  assert.equal(rollback.generation, 3);
  const reopened = await new HubStore({ dataDir }).init();
  assert.equal((await reopened.resolveRelease('personal')).id, old.id);
  assert.equal((await reopened.resolveRelease('personal', '1.1.0')).id, next.id);
  assert.equal((await reopened.listReleases()).length, 2);
});

test('canonical Unicode and line endings yield reproducible digests across targets', async t => {
  const { store } = await fixture(t);
  const first = await store.saveContent({ id: 'sample', kind: 'skill', title: 'Cafe\u0301', body: 'one\r\ntwo', resources: [{ path: 'b.txt', body: 'b' }, { path: 'a.txt', body: 'a\r\n' }] });
  const second = await store.saveContent({ id: 'sample', kind: 'skill', title: 'Café', body: 'one\ntwo', resources: [{ path: 'a.txt', body: 'a\n' }, { path: 'b.txt', body: 'b' }] });
  assert.equal(first.digest, second.digest);
  await store.saveBundle({ id: 'sample-pack', name: 'Sample', items: ['sample'] });
  const release = await store.buildRelease('sample-pack', '1.0.0');
  for (const target of ['codex', 'kimi', 'zcode']) {
    const artifact = await store.getArtifact(release.id, target);
    assert.equal(artifact.manifest.digest, createHash('sha256').update(artifact.content).digest('hex'));
    assert.equal(artifact.manifest.adapterStatus, 'generic-package');
    assert.equal(artifact.content, (await store.getArtifact(release.id, 'codex')).content);
  }
  const repeated = await store.buildRelease('sample-pack', '1.0.1');
  assert.equal(release.digest, repeated.digest);
});

test('invalid inputs and duplicate concurrent publication do not mutate releases', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.saveBundle({ id: 'bad', name: 'Bad', items: ['missing'] }), /Missing content/);
  await assert.rejects(store.saveContent({ id: 'bad', kind: 'skill', title: 'Bad', body: 'x', resources: [{ path: '../escape', body: 'x' }] }), /resource path/);
  await assert.rejects(store.saveContent({ id: 'constructor', kind: 'rule', title: 'Bad', body: 'x' }), /Invalid id/);
  await assert.rejects(store.buildRelease('missing', '1.0.0'), /Unknown bundle/);
  await assert.rejects(store.buildRelease('personal', 'latest'), /semantic version/);
  const outcomes = await Promise.allSettled([store.buildRelease('personal', '1.0.0'), store.buildRelease('personal', '1.0.0')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.listReleases()).length, 1);
  await assert.rejects(store.setChannel('other', 'stable', 'personal@1.0.0'), /does not belong/);
  await assert.rejects(store.resolveRelease('other', 'personal@1.0.0'), /not found/);
  await assert.rejects(store.getArtifact('personal@1.0.0', 'unknown'), /not found/);
});
