import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HubStore } from '../packages/core/index.mjs';
import { createStore, PostgresStore } from '../packages/storage/index.mjs';

test('store factory keeps file fallback and validates PostgreSQL schema names', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillhub-storage-file-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createStore({ dataDir });
  assert.ok(store instanceof HubStore);
  assert.ok(!(store instanceof PostgresStore));
  await store.init();
  assert.equal((await store.health()).backend, 'file');
  await store.close();
  assert.throws(() => createStore({ pool: {}, schema: 'unsafe; DROP TABLE x' }), /schema identifier/);
});

test('PostgreSQL transaction uses one client, rolls back failures and leaves external Pool ownership unchanged', async () => {
  const calls = [];
  const client = { query: async (...args) => { calls.push(args); return { rows: [] }; }, release: () => calls.push(['release']) };
  let ended = false;
  const pool = { connect: async () => client, end: async () => { ended = true; } };
  const store = new PostgresStore({ pool });
  await assert.rejects(store.transaction(async active => {
    assert.equal(active, client);
    await active.query('test statement');
    throw new Error('intentional failure');
  }), /intentional failure/);
  assert.deepEqual(calls.map(([sql]) => sql), ['BEGIN ISOLATION LEVEL READ COMMITTED', 'SELECT pg_advisory_xact_lock($1, $2)', 'test statement', 'ROLLBACK', 'release']);
  calls.length = 0;
  assert.equal(await store.transaction(async () => 'read', { readOnly: true }), 'read');
  assert.deepEqual(calls.map(([sql]) => sql), ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'release']);
  await store.close();
  assert.equal(ended, false);
  await assert.rejects(store.transaction(() => {}), /closed/);
});
