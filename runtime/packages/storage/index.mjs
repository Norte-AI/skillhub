import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { HubStore, canonicalJson, digest } from '../core/index.mjs';

const MAP_TABLES = { bundles: 'bundles', releases: 'releases', listings: 'listings', devices: 'devices', sessions: 'session_bindings', receipts: 'receipts', audit: 'audit_events', submissions: 'submissions', builds: 'build_jobs' };
const IMMUTABLE = new Set(['releases', 'sessions', 'receipts', 'audit']);
const emptyState = () => ({ schemaVersion: 1, content: {}, bundles: {}, releases: {}, channels: {}, listings: {}, devices: {}, sessions: {}, receipts: {}, audit: [], submissions: {}, builds: {} });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const own = (object, key) => Object.hasOwn(object, key);
const clone = value => structuredClone(value);
function storageError(message) { const error = new Error(message); error.code = 'STORAGE_VALIDATION_ERROR'; return error; }
function entries(value = {}) {
  return Array.isArray(value) ? value.map((item, index) => [item.id ?? `entry-${index}`, item]) : Object.entries(value);
}
function validateLegacy(state) {
  const supported = new Set(Object.keys(emptyState()));
  for (const key of Object.keys(state)) if (!supported.has(key)) throw storageError('Unknown legacy state field; import would discard data');
  for (const key of ['content', 'bundles', 'releases', 'channels', ...Object.keys(MAP_TABLES)]) {
    const value = state[key];
    if (!value || typeof value !== 'object' || (Array.isArray(value) && key !== 'audit')) throw storageError(`Invalid legacy ${key}`);
    if (Object.keys(value).some(id => own(Object.prototype, id) || id === '__proto__')) throw storageError('Unsafe legacy identity');
  }
  if (!Array.isArray(state.audit)) throw storageError('Legacy audit must be an array');
  for (const [id, revisions] of Object.entries(state.content)) {
    if (!Array.isArray(revisions) || !revisions.length) throw storageError('Invalid legacy content history');
    for (const [index, item] of revisions.entries()) {
      if (!item || item.id !== id || item.revision !== index + 1 || !['rule', 'role', 'skill'].includes(item.kind) || typeof item.body !== 'string' || typeof item.title !== 'string' || !Array.isArray(item.resources)) throw storageError('Invalid legacy content revision');
      const { revision, digest: declaredDigest, ...payload } = item;
      if (digest(payload) !== declaredDigest) throw storageError('Legacy content digest mismatch');
      const paths = new Set();
      for (const resource of item.resources) {
        const path = resource?.path;
        if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || paths.has(path) || typeof resource.body !== 'string') throw storageError('Unsafe legacy resource path or body');
        paths.add(path);
      }
    }
  }
  for (const [id, bundle] of Object.entries(state.bundles)) if (bundle?.id !== id || !Array.isArray(bundle.items) || bundle.items.some(contentId => !own(state.content, contentId))) throw storageError('Invalid legacy bundle reference');
  for (const [id, release] of Object.entries(state.releases)) {
    if (!release || release.id !== id || id !== `${release.bundleId}@${release.version}` || !own(state.bundles, release.bundleId) || !release.bundle || !Array.isArray(release.items) || !release.artifacts || typeof release.artifacts !== 'object') throw storageError('Invalid legacy release');
    for (const locked of release.items) {
      const revision = state.content[locked.id]?.find(item => item.revision === locked.revision);
      if (!revision || revision.digest !== locked.digest) throw storageError('Invalid legacy locked revision');
    }
    for (const [target, artifact] of Object.entries(release.artifacts)) {
      const manifest = artifact?.manifest;
      if (!manifest || manifest.releaseId !== id || manifest.bundleId !== release.bundleId || manifest.target !== target || manifest.version !== release.version || typeof artifact.content !== 'string' || createHash('sha256').update(artifact.content).digest('hex') !== manifest.digest) throw storageError('Legacy artifact digest or identity mismatch');
      let content;
      try { content = JSON.parse(artifact.content); } catch { throw storageError('Invalid legacy artifact content'); }
      if (digest({ schemaVersion: 1, bundle: release.bundle, content }) !== release.digest) throw storageError('Legacy release digest mismatch');
      const lockedContent = release.items.map(locked => state.content[locked.id].find(item => item.revision === locked.revision));
      if (!same(content, lockedContent)) throw storageError('Legacy artifact does not match locked content');
    }
  }
  for (const [bundleId, channels] of Object.entries(state.channels)) for (const [channel, pointer] of Object.entries(channels)) {
    if (!pointer || pointer.bundleId !== bundleId || pointer.channel !== channel || !own(state.releases, pointer.releaseId) || state.releases[pointer.releaseId].bundleId !== bundleId || !Number.isSafeInteger(pointer.generation) || pointer.generation < 1) throw storageError('Invalid legacy channel reference');
  }
  for (const listing of Object.values(state.listings)) if (!own(state.releases, listing.releaseId) || state.releases[listing.releaseId].bundleId !== listing.bundleId) throw storageError('Invalid legacy listing reference');
  for (const session of Object.values(state.sessions)) if (!own(state.devices, session.deviceId) || !Array.isArray(session.releaseIds) || session.releaseIds.some(id => !own(state.releases, id))) throw storageError('Invalid legacy session reference');
  for (const receipt of Object.values(state.receipts)) if (!own(state.devices, receipt.deviceId) || !own(state.releases, receipt.releaseId) || (receipt.sessionId && !own(state.sessions, receipt.sessionId))) throw storageError('Invalid legacy receipt reference');
}

/** Entity storage with one transaction-scoped advisory lock per database/schema. */
export class PostgresStore extends HubStore {
  constructor({ connectionString, databaseUrl, pool, signingKey, schema = 'skillhub' } = {}) {
    super({ dataDir: '.', signingKey });
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw storageError('Invalid PostgreSQL schema identifier');
    if (!pool && !(connectionString || databaseUrl)) throw storageError('PostgreSQL connectionString or Pool is required');
    this.schema = schema;
    this.pool = pool ?? new Pool({ connectionString: connectionString || databaseUrl, connectionTimeoutMillis: 5000 });
    this.ownsPool = !pool;
    if (this.ownsPool) {
      // PostgreSQL removes broken idle clients automatically. Handling the event
      // keeps a transient database restart from becoming an uncaught exception.
      this.pool.on('error', () => { this.lastPoolErrorAt = new Date().toISOString(); });
    }
    this.lockKey = createHash('sha256').update(`skillhub:${schema}`).digest().readInt32BE(0);
    this.closed = false;
  }
  table(name) { return `"${this.schema}"."${name}"`; }
  async transaction(operation, { readOnly = false } = {}) {
    if (this.closed) throw storageError('Store is closed');
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED');
      if (!readOnly) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1397249346, this.lockKey]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep the original failure. */ }
      throw error;
    } finally { client.release(); }
  }
  async init() {
    await this.transaction(async client => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.table('schema_migrations')} (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const versions = await client.query(`SELECT version FROM ${this.table('schema_migrations')} ORDER BY version`);
      if (versions.rows.some(row => row.version > 1)) throw storageError('Unsupported PostgreSQL storage schema');
      if (!versions.rows.some(row => row.version === 1)) {
        await client.query(`CREATE TABLE ${this.table('content_revisions')} (content_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0), payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), PRIMARY KEY(content_id, revision))`);
        for (const table of Object.values(MAP_TABLES)) await client.query(`CREATE TABLE ${this.table(table)} (id text PRIMARY KEY, position integer NOT NULL DEFAULT 0, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'))`);
        await client.query(`CREATE UNIQUE INDEX release_bundle_version ON ${this.table('releases')} ((payload->>'bundleId'), (payload->>'version'))`);
        await client.query(`CREATE INDEX release_bundle ON ${this.table('releases')} ((payload->>'bundleId'))`);
        await client.query(`CREATE TABLE ${this.table('channels')} (bundle_id text NOT NULL, channel text NOT NULL, release_id text NOT NULL REFERENCES ${this.table('releases')}(id), generation integer NOT NULL CHECK (generation > 0), payload jsonb NOT NULL, PRIMARY KEY(bundle_id, channel))`);
        await client.query(`CREATE TABLE ${this.table('collection_shapes')} (name text PRIMARY KEY, is_array boolean NOT NULL)`);
        await client.query(`INSERT INTO ${this.table('schema_migrations')} (version) VALUES (1)`);
      }
    });
    await this.transaction(async client => {
      for (const table of ['submissions', 'build_jobs']) await client.query(`CREATE TABLE IF NOT EXISTS ${this.table(table)} (id text PRIMARY KEY, position integer NOT NULL DEFAULT 0, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'))`);
    });
    this.state = await this.readSnapshot();
    return this;
  }
  async load(client) {
    const state = emptyState();
    const shapes = await client.query(`SELECT name, is_array FROM ${this.table('collection_shapes')}`);
    const arrayCollections = new Set(shapes.rows.filter(row => row.is_array).map(row => row.name));
    const content = await client.query(`SELECT content_id, payload FROM ${this.table('content_revisions')} ORDER BY content_id, revision`);
    for (const row of content.rows) {
      if (!own(state.content, row.content_id)) Object.defineProperty(state.content, row.content_id, { value: [], enumerable: true, configurable: true, writable: true });
      state.content[row.content_id].push(row.payload);
    }
    for (const [key, table] of Object.entries(MAP_TABLES)) {
      const rows = await client.query(`SELECT id, payload FROM ${this.table(table)} ORDER BY position, id`);
      if (arrayCollections.has(key)) state[key] = rows.rows.map(row => row.payload);
      else if (rows.rows.length || key !== 'audit') state[key] = Object.fromEntries(rows.rows.map(row => [row.id, row.payload]));
    }
    const channels = await client.query(`SELECT bundle_id, channel, payload FROM ${this.table('channels')} ORDER BY bundle_id, channel`);
    for (const row of channels.rows) {
      if (!own(state.channels, row.bundle_id)) Object.defineProperty(state.channels, row.bundle_id, { value: {}, enumerable: true, configurable: true, writable: true });
      Object.defineProperty(state.channels[row.bundle_id], row.channel, { value: row.payload, enumerable: true, configurable: true, writable: true });
    }
    return state;
  }
  async readSnapshot() { return this.transaction(client => this.load(client), { readOnly: true }); }
  async refresh() { return this; } // Read APIs refresh transactionally; mutations reload under the write lock.
  async persist() { throw storageError('Use transaction-based mutate; direct state persistence is disabled'); }
  async save(client, previous, next) {
    if (next.schemaVersion !== 1) throw storageError('Unsupported state schema');
    for (const [id, revisions] of Object.entries(previous.content)) {
      const updated = next.content[id];
      if (!Array.isArray(updated) || revisions.some((revision, index) => !same(revision, updated[index]))) throw storageError('Content revisions are immutable');
    }
    for (const [id, revisions] of Object.entries(next.content)) {
      if (!Array.isArray(revisions)) throw storageError('Content history must be an array');
      const oldCount = own(previous.content, id) ? previous.content[id].length : 0;
      for (let index = oldCount; index < revisions.length; index++) {
        const item = revisions[index];
        if (item.id !== id || item.revision !== index + 1) throw storageError('Invalid content revision sequence');
        await client.query(`INSERT INTO ${this.table('content_revisions')} (content_id, revision, payload) VALUES ($1, $2, $3::jsonb)`, [id, item.revision, JSON.stringify(item)]);
      }
    }
    for (const [key, table] of Object.entries(MAP_TABLES)) {
      const before = Object.fromEntries(entries(previous[key]));
      const after = entries(next[key]);
      const ids = new Set(after.map(([id]) => id));
      if (ids.size !== after.length) throw storageError(`Duplicate ${key} identity`);
      if (IMMUTABLE.has(key)) {
        for (const [id, value] of Object.entries(before)) {
          const updated = after.find(([newId]) => newId === id)?.[1];
          if (!updated || !same(value, updated)) throw storageError(`${key} records are immutable`);
        }
      }
      await client.query(`INSERT INTO ${this.table('collection_shapes')} (name, is_array) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET is_array = EXCLUDED.is_array`, [key, Array.isArray(next[key])]);
      for (const [position, [id, value]] of after.entries()) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw storageError(`Invalid ${key} record`);
        if (own(before, id) && same(before[id], value)) continue;
        await client.query(`INSERT INTO ${this.table(table)} (id, position, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, payload = EXCLUDED.payload`, [id, position, JSON.stringify(value)]);
      }
      for (const id of Object.keys(before)) if (!ids.has(id)) await client.query(`DELETE FROM ${this.table(table)} WHERE id = $1`, [id]);
    }
    const beforeChannels = new Map(Object.entries(previous.channels).flatMap(([bundleId, channels]) => Object.entries(channels).map(([name, value]) => [JSON.stringify([bundleId, name]), value])));
    const afterChannels = new Set();
    for (const [bundleId, channels] of Object.entries(next.channels)) for (const [channel, value] of Object.entries(channels)) {
      const key = JSON.stringify([bundleId, channel]); afterChannels.add(key);
      if (same(beforeChannels.get(key), value)) continue;
      await client.query(`INSERT INTO ${this.table('channels')} (bundle_id, channel, release_id, generation, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (bundle_id, channel) DO UPDATE SET release_id = EXCLUDED.release_id, generation = EXCLUDED.generation, payload = EXCLUDED.payload`, [bundleId, channel, value.releaseId, value.generation, JSON.stringify(value)]);
    }
    for (const key of beforeChannels.keys()) if (!afterChannels.has(key)) await client.query(`DELETE FROM ${this.table('channels')} WHERE bundle_id = $1 AND channel = $2`, JSON.parse(key));
  }
  mutate(operation) {
    const next = this.queue.then(async () => {
      if (!this.state) throw storageError('Store is not initialized');
      const committed = await this.transaction(async client => {
        const previous = await this.load(client);
        const state = clone(previous);
        const result = operation(state);
        if (result && typeof result.then === 'function') throw storageError('Mutation callback must be synchronous');
        await this.save(client, previous, state);
        return { state, result: clone(result) };
      });
      this.state = committed.state;
      return committed.result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async health() {
    return this.transaction(async client => {
      const { rows } = await client.query(`SELECT max(version) AS version FROM ${this.table('schema_migrations')}`);
      return { status: 'ok', backend: 'postgres', schemaVersion: rows[0].version };
    }, { readOnly: true });
  }
  async close() {
    await this.queue;
    this.closed = true;
    if (this.ownsPool) await this.pool.end();
  }
  async importLegacy({ dataDir, state: suppliedState } = {}) {
    const imported = suppliedState ?? JSON.parse(await readFile(resolve(dataDir, 'hub.json'), 'utf8'));
    if (imported.schemaVersion !== 1) throw storageError('Unsupported legacy schema');
    for (const key of ['content', 'bundles', 'releases', 'channels']) if (!imported[key] || typeof imported[key] !== 'object' || Array.isArray(imported[key])) throw storageError(`Invalid legacy ${key}`);
    const next = { ...emptyState(), ...clone(imported) };
    validateLegacy(next);
    const committed = await this.transaction(async client => {
      const previous = await this.load(client);
      if (Object.keys(previous.content).length || Object.keys(previous.channels).length || Object.keys(MAP_TABLES).some(key => entries(previous[key]).length)) throw storageError('Import requires an empty database schema; existing data will not be overwritten');
      await this.save(client, previous, next);
      return next;
    });
    this.state = committed;
    return { imported: true, counts: { contentRevisions: Object.values(next.content).reduce((sum, values) => sum + values.length, 0), ...Object.fromEntries(Object.keys(MAP_TABLES).map(key => [key, entries(next[key]).length])) } };
  }
}

// All inherited read APIs evaluate against a fresh consistent database snapshot.
// A read-only HubStore view prevents nested APIs (getArtifact -> getRelease) from
// replacing shared mutable snapshots while another request is in progress.
const READ_METHODS = ['listContent', 'listBundles', 'listListings', 'getListing', 'listReleases', 'resolveRelease', 'getRelease', 'getArtifact', 'listDevices', 'getDevice', 'authenticateDeviceToken', 'listSessionBindings', 'getSessionBinding', 'listReceipts', 'listAudit'];
for (const name of READ_METHODS) Object.defineProperty(PostgresStore.prototype, name, {
  configurable: true,
  value: async function (...args) {
    const implementation = HubStore.prototype[name];
    if (typeof implementation !== 'function') throw storageError(`Core does not implement ${name}`);
    const view = Object.create(HubStore.prototype);
    view.state = await this.readSnapshot();
    return implementation.apply(view, args);
  },
});

/** Returns an uninitialized store; callers use the common await store.init(). */
export function createStore({ databaseUrl, connectionString, dataDir = '.skillhub-data', pool, schema, signingKey } = {}) {
  return databaseUrl || connectionString || pool ? new PostgresStore({ connectionString: connectionString || databaseUrl, pool, schema, signingKey }) : new HubStore({ dataDir, signingKey });
}
