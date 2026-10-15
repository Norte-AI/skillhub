import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubStore } from '../packages/core/index.mjs';
import { submitSkill, reviewSubmission, getSubmission, listSubmissions, validateSkillUpload, assertReleaseApproved } from '../packages/review/index.mjs';
const actor = { role: 'admin', id: 'reviewer' };
const upload = { contentId: 'writing', body: '---\nname: writing\ndescription: Help write a document\n---\nFollow the user instructions.', resources: [{ path: 'examples/example.md', body: 'Example' }] };
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'hub-review-'));
  t.after(() => rm(dataDir, { force: true, recursive: true }));
  return { store: await new HubStore({ dataDir }).init(), dataDir };
}
test('pending upload remains isolated; approval persists exact content and provenance', async t => {
  const { store, dataDir } = await fixture(t);
  const pending = await submitSkill(store, upload, actor);
  assert.equal((await store.listContent()).length, 0);
  pending.payload.body = 'caller tampering';
  const approved = await reviewSubmission(store, pending.id, { decision: 'approve', comment: 'Reviewed instructions and resources' }, actor);
  const revision = (await store.listContent())[0];
  assert.equal(revision.body, upload.body);
  assert.equal(approved.approvedDigest, revision.digest);
  assert.equal(revision.submissionId, pending.id);
  const reopened = await new HubStore({ dataDir }).init();
  assert.equal((await getSubmission(reopened, pending.id)).status, 'approved');
  assert.equal((await listSubmissions(reopened, { status: 'pending' })).length, 0);
  assert.equal((await reopened.listAudit()).length, 2);
  await assert.rejects(reviewSubmission(store, pending.id, { decision: 'reject', comment: 'Changed mind' }, actor), { code: 'CONFLICT' });
});
test('rejection does not create content; resubmission is a new immutable submission', async t => {
  const { store } = await fixture(t);
  const first = await submitSkill(store, { ...upload, id: 'first' }, actor);
  await reviewSubmission(store, first.id, { decision: 'reject', comment: 'Add usage examples' }, actor);
  assert.equal((await store.listContent()).length, 0);
  await assert.rejects(submitSkill(store, { ...upload, id: 'first' }, actor), { code: 'CONFLICT' });
  const second = await submitSkill(store, { ...upload, id: 'second' }, actor);
  assert.equal(second.status, 'pending');
  assert.equal((await getSubmission(store, first.id)).status, 'rejected');
});
test('release gate permits approved revision during pending update and blocks direct edit bypass', async t => {
  const { store } = await fixture(t);
  const first = await submitSkill(store, upload, actor);
  await reviewSubmission(store, first.id, { decision: 'approve', comment: 'Ready' }, actor);
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['writing'] });
  const bundle = (await store.listBundles())[0];
  assert.doesNotThrow(() => assertReleaseApproved(store.state, bundle));
  const release = await store.buildRelease('personal', '1.0.0');
  assert.equal(release.items[0].revision, 1);
  await submitSkill(store, { ...upload, body: upload.body + '\nNew draft' }, actor);
  assert.doesNotThrow(() => assertReleaseApproved(store.state, bundle));
  await store.saveContent({ id: 'writing', kind: 'skill', title: 'Bypass', body: 'unreviewed instructions' });
  assert.throws(() => assertReleaseApproved(store.state, bundle), { code: 'FORBIDDEN' });
  await assert.rejects(store.buildRelease('personal', '1.0.1'), { code: 'FORBIDDEN' });
  assert.equal((await store.getRelease(release.id)).items[0].revision, 1);
});
test('upload validation blocks traversal, reserved root file, duplicates, malformed skill metadata and unauthorized writes', async t => {
  const { store } = await fixture(t);
  for (const path of ['../escape', '/absolute', 'x\\y', 'SKILL.md', 'a/./b']) assert.throws(() => validateSkillUpload({ ...upload, resources: [{ path, body: '' }] }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateSkillUpload({ ...upload, resources: [upload.resources[0], upload.resources[0]] }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateSkillUpload({ ...upload, body: '# No metadata' }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(submitSkill(store, upload, { role: 'device' }), { code: 'FORBIDDEN' });
});

test('approved skill preserves dependency ids in immutable payload and digest', async t => {
  const { store } = await fixture(t);
  const pending = await submitSkill(store, { ...upload, dependencies: ['base'] }, actor);
  assert.deepEqual(pending.payload.dependencies, ['base']);
  await reviewSubmission(store, pending.id, { decision: 'approve', comment: 'Reviewed dependency' }, actor);
  const revision = (await store.listContent())[0];
  assert.deepEqual(revision.dependencies, ['base']);
  assert.equal((await getSubmission(store, pending.id)).approvedDigest, revision.digest);
  for (const dependencies of [['base', 'base'], ['../escape'], 'base']) assert.throws(() => validateSkillUpload({ ...upload, dependencies }), { code: 'VALIDATION_ERROR' });
});
