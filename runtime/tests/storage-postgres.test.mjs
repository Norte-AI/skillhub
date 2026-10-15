import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { HubStore } from '../packages/core/index.mjs';
import { PostgresStore } from '../packages/storage/index.mjs';

const connectionString = process.env.SKILLHUB_TEST_DATABASE_URL;
const integration = { skip: connectionString ? false : 'SKILLHUB_TEST_DATABASE_URL is unset; real PostgreSQL integration was not executed' };
async function fixture(t) {
  const schema = `skillhub_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString });
  const first = new PostgresStore({ pool, schema });
  const second = new PostgresStore({ connectionString, schema });
  t.after(async () => {
    await Promise.all([first.close(), second.close()]);
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });
  await Promise.all([first.init(), second.init()]);
  return { first, second, pool, schema };
}
async function seed(store) {
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: 'Original' });
  await store.saveBundle({ id: 'personal', name: 'Personal', items: ['rule'] });
  return store.buildRelease('personal', '1.0.0');
}

test('real PostgreSQL migrations, cross-instance refresh and concurrent writes retain every revision', integration, async t => {
  const { first, second, pool, schema } = await fixture(t);
  const release = await seed(first);
  assert.equal((await second.listBundles())[0].id, 'personal');
  const original = await second.getArtifact(release.id, 'codex');
  await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).saveContent({ id: 'rule', kind: 'rule', title: 'Rule', body: `Revision ${index}` })));
  const latest = (await second.listContent())[0];
  assert.equal(latest.revision, 9);
  const revisions = await pool.query(`SELECT count(*)::int AS count FROM "${schema}".content_revisions`);
  assert.equal(revisions.rows[0].count, 9);
  assert.deepEqual(await first.getArtifact(release.id, 'codex'), original);
  assert.equal((await first.health()).backend, 'postgres');
  await first.init();
  assert.equal((await second.listReleases()).length, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".schema_migrations`)).rows[0].count, 1);
});

test('real PostgreSQL serializes duplicate releases and channel CAS, rolls back partial writes and preserves history', integration, async t => {
  const { first, second } = await fixture(t);
  const old = await seed(first);
  await first.setChannel('personal', 'stable', old.id, { expectedGeneration: 0 });
  const publication = await Promise.allSettled([first.buildRelease('personal', '1.1.0'), second.buildRelease('personal', '1.1.0')]);
  assert.equal(publication.filter(value => value.status === 'fulfilled').length, 1);
  const current = publication.find(value => value.status === 'fulfilled').value;
  const switches = await Promise.allSettled([first.setChannel('personal', 'stable', current.id, { expectedGeneration: 1 }), second.setChannel('personal', 'stable', old.id, { expectedGeneration: 1 })]);
  assert.equal(switches.filter(value => value.status === 'fulfilled').length, 1);
  assert.match(switches.find(value => value.status === 'rejected').reason.message, /generation conflict/);
  await first.setChannel('personal', 'stable', old.id, { expectedGeneration: 2 });
  assert.equal((await second.resolveRelease('personal')).id, old.id);
  const before = await second.listContent();
  await assert.rejects(first.mutate(state => {
    state.content.extra = [{ id: 'extra', kind: 'rule', title: 'Extra', body: 'must roll back', resources: [], revision: 1, digest: 'test' }];
    state.releases[old.id].version = 'invalid mutation';
  }), /immutable/);
  assert.deepEqual(await second.listContent(), before);
  assert.equal((await second.getRelease(old.id)).version, '1.0.0');
  await first.publishListing({ bundleId: 'personal', releaseId: current.id });
  assert.equal((await second.listListings())[0].releaseId, current.id);
  await second.unpublishListing('personal');
  assert.deepEqual(await first.listListings(), []);
  assert.equal((await first.getListing('personal')).history.length, 2);
});

test('real PostgreSQL persists device tokens, fixed sessions, unverified receipts and audit as separate entities', integration, async t => {
  const { first, second, pool, schema } = await fixture(t);
  const release = await seed(first);
  await first.registerDevice({ id: 'desktop', name: 'Desktop', client: 'codex', assignments: ['personal'] });
  const { token } = await first.issueDeviceToken('desktop');
  assert.deepEqual(await second.authenticateDeviceToken(token), { role: 'device', deviceId: 'desktop' });
  assert.equal(Object.hasOwn((await second.listDevices())[0], 'tokenHash'), false);
  const session = await second.bindSession({ id: 'session-one', deviceId: 'desktop', releaseIds: [release.id] });
  assert.deepEqual(await first.getSessionBinding(session.id), session);
  const receipt = await first.reportReceipt({ id: 'receipt-one', deviceId: 'desktop', sessionId: session.id, releaseId: release.id, kind: 'injected', evidence: 'client claim' });
  assert.equal(receipt.verification, 'unverified');
  assert.equal((await second.listReceipts({ deviceId: 'desktop' })).length, 1);
  await first.revokeDeviceToken('desktop');
  assert.equal(await second.authenticateDeviceToken(token), null);
  const audit = await first.listAudit();
  assert.ok(audit.some(item => item.action === 'session.bound'));
  for (const table of ['devices', 'session_bindings', 'receipts', 'audit_events']) assert.ok((await pool.query(`SELECT count(*)::int AS count FROM "${schema}"."${table}"`)).rows[0].count > 0);
});

test('real PostgreSQL legacy import is transactional and refuses populated schemas', integration, async t => {
  const { first, second } = await fixture(t);
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-legacy-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacy = await new HubStore({ dataDir }).init();
  const release = await seed(legacy);
  await legacy.setChannel('personal', 'stable', release.id);
  await legacy.publishListing({ bundleId: 'personal', releaseId: release.id });
  const broken = structuredClone(legacy.state);
  broken.channels.personal.stable.releaseId = 'absent';
  await assert.rejects(first.importLegacy({ state: broken }));
  assert.deepEqual(await second.listContent(), []);
  const partial = structuredClone(legacy.state);
  partial.audit = [{ id: 'duplicate', action: 'first' }, { id: 'duplicate', action: 'second' }];
  await assert.rejects(first.importLegacy({ state: partial }), /Duplicate audit identity/);
  assert.deepEqual(await second.listContent(), []);
  const imported = await first.importLegacy({ dataDir });
  assert.equal(imported.counts.contentRevisions, 1);
  assert.equal((await second.resolveRelease('personal')).id, release.id);
  assert.deepEqual(await second.getArtifact(release.id, 'codex'), await legacy.getArtifact(release.id, 'codex'));
  assert.equal((await second.listListings()).length, 1);
  await assert.rejects(first.importLegacy({ dataDir }), /empty database schema/);
  assert.equal((await second.listReleases()).length, 1);
});

const dockerBackupEnabled = connectionString && process.env.SKILLHUB_TEST_PG_DOCKER_BACKUP === '1';
test('real pg_dump/pg_restore recover fixed releases, session receipts and revoked tokens in an isolated database', {
  skip: dockerBackupEnabled ? false : 'Docker backup drill requires SKILLHUB_TEST_DATABASE_URL and SKILLHUB_TEST_PG_DOCKER_BACKUP=1 for the local development compose fixture',
}, async t => {
  const parsed = new URL(connectionString);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '55432');
  assert.equal(parsed.pathname, '/skillhub');
  assert.equal(parsed.username, 'skillhub');
  const { first, second, pool, schema } = await fixture(t);
  const release = await seed(first);
  await first.setChannel('personal', 'stable', release.id);
  await first.registerDevice({ id: 'restore-device', name: 'Restore fixture', client: 'codex', assignments: ['personal'] });
  const { token } = await first.issueDeviceToken('restore-device');
  await first.bindSession({ id: 'restore-session', deviceId: 'restore-device', releaseIds: [release.id] });
  const receipt = await first.reportReceipt({ id: 'restore-receipt', deviceId: 'restore-device', sessionId: 'restore-session', releaseId: release.id, kind: 'fetched', digest: release.digest });
  await first.revokeDeviceToken('restore-device');
  await first.saveContent({ id: 'rule', kind: 'rule', title: 'Draft', body: 'Different current draft' });
  const snapshot = await second.getRelease(release.id);
  const audit = await first.listAudit();
  const database = `skillhub_restore_${randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE DATABASE "${database}"`);
  let restored;
  t.after(async () => {
    if (restored) await restored.close();
    // Uses a separate administrative Pool because fixture cleanup may have ended
    // its external Pool before this after hook runs.
    const admin = new Pool({ connectionString });
    try { await admin.query(`DROP DATABASE IF EXISTS "${database}"`); } finally { await admin.end(); }
  });
  const compose = fileURLToPath(new URL('../infra/docker-compose.yml', import.meta.url));
  const dump = spawnSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'skillhub', '-d', 'skillhub', '--schema', schema, '--format=custom'], { maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  assert.equal(dump.status, 0, dump.stderr?.toString() || dump.error?.message);
  assert.ok(dump.stdout.length > 0);
  const restore = spawnSync('docker', ['compose', '-f', compose, 'exec', '-T', 'postgres', 'pg_restore', '-U', 'skillhub', '-d', database, '--no-owner', '--no-acl', '--single-transaction', '--exit-on-error'], { input: dump.stdout, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
  assert.equal(restore.status, 0, restore.stderr?.toString() || restore.error?.message);
  parsed.pathname = `/${database}`;
  restored = await new PostgresStore({ connectionString: parsed.toString(), schema }).init();
  assert.deepEqual(await restored.getRelease(release.id), snapshot);
  assert.equal((await restored.resolveRelease('personal')).id, release.id);
  assert.equal(JSON.parse((await restored.getArtifact(release.id, 'codex')).content)[0].body, 'Original');
  assert.deepEqual((await restored.listReceipts({ sessionId: 'restore-session' }))[0], receipt);
  assert.equal((await restored.getSessionBinding('restore-session')).releaseIds[0], release.id);
  assert.equal(await restored.authenticateDeviceToken(token), null);
  assert.deepEqual(await restored.listAudit(), audit);
});
