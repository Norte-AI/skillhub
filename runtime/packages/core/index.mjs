import { resolveContentGraph } from '../compiler/index.mjs';
import { signArtifact } from '../signing/index.mjs';
import { assertReleaseApproved } from '../review/index.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const TARGETS = ['codex', 'kimi', 'zcode'];
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const copy = value => structuredClone(value);
const normalize = value => value.replace(/\r\n?/g, '\n').normalize('NFC');
function fail(message, code = 'VALIDATION_ERROR') { const error = new Error(message); error.code = code; throw error; }
const auditActors = new AsyncLocalStorage();
export function withAuditActor(actor, operation) { return auditActors.run(actor, operation); }
function audit(state, action, objectId) { state.audit ??= []; state.audit.push({ id: randomUUID(), action, objectId, actor: auditActors.getStore() ?? { role: 'system' }, timestamp: new Date().toISOString() }); }
function identifier(value, name = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || Object.hasOwn(Object.prototype, value)) fail(`Invalid ${name}`);
  return value;
}
function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`);
  return normalize(value);
}
function stringArray(value, name) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || new Set(value).size !== value.length) fail(`Invalid ${name}`);
  return value.map(item => normalize(item));
}
function resources(input = []) {
  if (!Array.isArray(input)) fail('resources must be an array of {path, body}');
  const seen = new Set();
  return input.map(resource => {
    const path = resource?.path;
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('Invalid resource path');
    if (seen.has(path)) fail('Duplicate resource path');
    seen.add(path);
    if (typeof resource.body !== 'string') fail('Resource body must be a string');
    return { path, body: normalize(resource.body) };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Single-process development store. All mutations are committed by one atomic rename. */
export class HubStore {
  constructor({ dataDir, signingKey }) {
    if (!dataDir) throw new Error('dataDir is required');
    this.signingKey = signingKey;
    this.dataDir = resolve(dataDir);
    this.file = join(this.dataDir, 'hub.json');
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try { this.state = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { schemaVersion: 1, content: {}, bundles: {}, releases: {}, channels: {}, listings: {} };
      await this.persist(this.state);
    }
    if (this.state.schemaVersion !== 1) throw new Error('Unsupported store schema');
    this.state.listings ??= {};
    this.state.devices ??= {};
    this.state.sessions ??= {};
    this.state.receipts ??= {};
    this.state.audit ??= [];
    this.state.submissions ??= {};
    this.state.builds ??= {};
    return this;
  }
  async persist(state) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temp, this.file);
  }
  mutate(operation) {
    const next = this.queue.then(async () => {
      if (!this.state) throw new Error('Store is not initialized');
      const state = copy(this.state);
      const result = operation(state);
      await this.persist(state);
      this.state = state;
      return copy(result);
    });
    this.queue = next.catch(() => {});
    return next;
  }
  async listContent() { return copy(Object.values(this.state.content).map(history => history.at(-1))); }
  async saveContent(input) {
    const id = identifier(input.id);
    if (!['rule', 'role', 'skill'].includes(input.kind)) fail('Invalid content kind');
    if (input.dependencies !== undefined) stringArray(input.dependencies, 'dependencies').forEach(value => identifier(value, 'dependency id'));
    const value = { ...(input.dependencies !== undefined ? { dependencies: copy(input.dependencies) } : {}), id, kind: input.kind, title: requiredText(input.title, 'title'), body: requiredText(input.body, 'body'), resources: resources(input.resources) };
    return this.mutate(state => {
      const history = state.content[id] ??= [];
      const item = { ...value, revision: history.length + 1, digest: digest(value) };
      history.push(item);
      audit(state, 'content.saved', id);
      return item;
    });
  }
  async listBundles() { return copy(Object.values(this.state.bundles)); }
  async listListings({ query = '', target } = {}) {
    if (typeof query !== 'string') fail('Invalid search query');
    if (target !== undefined && !TARGETS.includes(target)) fail('Unsupported target');
    const search = normalize(query).trim().toLocaleLowerCase('en');
    return copy(Object.values(this.state.listings).filter(listing => listing.status === 'published'
      && (!target || listing.targets.includes(target))
      && (!search || [listing.bundleId, listing.name, listing.description, ...listing.tags].join('\n').toLocaleLowerCase('en').includes(search))));
  }
  async getListing(bundleId) {
    identifier(bundleId, 'bundle id');
    const listing = Object.hasOwn(this.state.listings, bundleId) ? this.state.listings[bundleId] : undefined;
    if (!listing) fail(`Unknown listing: ${bundleId}`, 'NOT_FOUND');
    return copy(listing);
  }
  async publishListing({ bundleId, releaseId, visibility = 'private' }) {
    identifier(bundleId, 'bundle id');
    if (typeof releaseId !== 'string') fail('A fixed release id is required');
    if (!['private', 'public'].includes(visibility)) fail('Invalid listing visibility');
    return this.mutate(state => {
      const release = Object.hasOwn(state.releases, releaseId) ? state.releases[releaseId] : undefined;
      if (!release || release.bundleId !== bundleId || release.status !== 'ready') fail('Only a ready release belonging to this bundle can be listed');
      const bundle = release.bundle;
      const compatibility = Object.fromEntries(bundle.targets.map(target => {
        const artifact = release.artifacts[target];
        if (!artifact || artifact.manifest.releaseId !== releaseId) fail(`Missing release artifact: ${target}`);
        return [target, { adapterStatus: artifact.manifest.adapterStatus ?? 'unknown', loaded: false, verified: false, digest: artifact.manifest.digest }];
      }));
      const previous = state.listings[bundleId];
      const snapshot = { id: bundleId, bundleId, name: bundle.name, description: bundle.description, tags: copy(bundle.tags), targets: copy(bundle.targets), releaseId, version: release.version, digest: release.digest, compatibility, visibility, status: 'published', generation: (previous?.generation ?? 0) + 1, updatedAt: new Date().toISOString() };
      state.listings[bundleId] = { ...snapshot, history: [...(previous?.history ?? []), { action: 'publish', ...copy(snapshot) }] };
      audit(state, 'listing.updated', bundleId);
      return state.listings[bundleId];
    });
  }
  async unpublishListing(bundleId) {
    identifier(bundleId, 'bundle id');
    return this.mutate(state => {
      if (!Object.hasOwn(state.listings, bundleId)) fail(`Unknown listing: ${bundleId}`, 'NOT_FOUND');
      const { history, ...previous } = state.listings[bundleId];
      if (previous.status === 'unpublished') return state.listings[bundleId];
      const snapshot = { ...previous, status: 'unpublished', generation: previous.generation + 1, updatedAt: new Date().toISOString() };
      state.listings[bundleId] = { ...snapshot, history: [...history, { action: 'unpublish', ...copy(snapshot) }] };
      audit(state, 'listing.updated', bundleId);
      return state.listings[bundleId];
    });
  }
  async saveBundle(input) {
    const id = identifier(input.id);
    const items = stringArray(input.items, 'items').map(value => identifier(value, 'content id'));
    if (!items.length) fail('Bundle must contain at least one item');
    const targets = stringArray(input.targets ?? TARGETS, 'targets');
    if (!targets.length || targets.some(target => !TARGETS.includes(target))) fail('Unsupported target');
    if (input.description !== undefined && typeof input.description !== 'string') fail('Invalid description');
    const value = { id, name: requiredText(input.name, 'name'), description: normalize(input.description ?? ''), items, tags: stringArray(input.tags ?? [], 'tags'), targets };
    return this.mutate(state => {
      for (const item of items) if (!state.content[item]) fail(`Missing content: ${item}`);
      state.bundles[id] = { ...value, revision: (state.bundles[id]?.revision ?? 0) + 1 };
      audit(state, 'bundle.saved', id);
      return state.bundles[id];
    });
  }
  async buildRelease(bundleId, version, { expectedInputDigest, dryRun = false } = {}) {
    identifier(bundleId, 'bundle id');
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail('Version must use semantic version format');
    return this.mutate(state => {
      const bundle = state.bundles[bundleId];
      if (!bundle) fail(`Unknown bundle: ${bundleId}`, 'NOT_FOUND');
      const id = `${bundleId}@${version}`;
      if (state.releases[id]) fail(`Version already published: ${version}`, 'CONFLICT');
      const content = resolveContentGraph(state, bundle.items);
      assertReleaseApproved(state, { items: content.map(item => item.id) });
      const locked = content.map(({ id, revision, digest }) => ({ id, revision, digest }));
      const payload = { schemaVersion: 1, bundle: copy(bundle), content };
      const releaseDigest = digest(payload);
      if (expectedInputDigest && expectedInputDigest !== releaseDigest) fail('Build inputs changed after enqueue; submit a new build', 'CONFLICT');
      const serializedContent = canonicalJson(content);
      const contentDigest = createHash('sha256').update(serializedContent).digest('hex');
      const artifacts = Object.fromEntries(bundle.targets.map(target => {
        const artifact = { manifest: { schemaVersion: 1, releaseId: id, bundleId, version, target, adapterStatus: 'generic-package', digest: contentDigest }, content: serializedContent };
        return [target, { ...artifact, digest: digest(artifact) }];
      }));
      const release = { id, bundleId, version, bundleRevision: bundle.revision, bundle: copy(bundle), items: locked, digest: releaseDigest, status: 'ready', createdAt: new Date().toISOString(), artifacts };
      if (this.signingKey) for (const artifact of Object.values(artifacts)) artifact.signature = signArtifact(artifact, { ...this.signingKey, releaseDigest });
      if (dryRun) return release;
      state.releases[id] = release;
      audit(state, 'release.built', id);
      return release;
    });
  }
  async listReleases(bundleId) { return copy(Object.values(this.state.releases).filter(release => !bundleId || release.bundleId === bundleId)); }
  async setChannel(bundleId, channel, releaseId, { expectedGeneration } = {}) {
    if (expectedGeneration !== undefined && (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)) fail('Invalid expectedGeneration');
    identifier(bundleId, 'bundle id'); identifier(channel, 'channel');
    return this.mutate(state => {
      const release = Object.hasOwn(state.releases, releaseId) ? state.releases[releaseId] : undefined;
      if (!release || release.bundleId !== bundleId) fail('Release does not belong to bundle');
      const channels = state.channels[bundleId] ??= {};
      const previous = channels[channel];
      if (expectedGeneration !== undefined && (previous?.generation ?? 0) !== expectedGeneration) fail('Channel generation conflict', 'CONFLICT');
      channels[channel] = { bundleId, channel, releaseId, generation: (previous?.generation ?? 0) + 1, updatedAt: new Date().toISOString() };
      audit(state, 'channel.updated', `${bundleId}/${channel}`);
      return channels[channel];
    });
  }
  async resolveRelease(bundleId, channelOrRelease = 'stable') {
    identifier(bundleId, 'bundle id');
    if (typeof channelOrRelease !== 'string') fail('Invalid channel or release');
    const channels = Object.hasOwn(this.state.channels, bundleId) ? this.state.channels[bundleId] : {};
    const id = (Object.hasOwn(channels, channelOrRelease) ? channels[channelOrRelease].releaseId : undefined) ?? channelOrRelease;
    const exact = Object.hasOwn(this.state.releases, id) ? this.state.releases[id] : undefined;
    const versionId = `${bundleId}@${id}`;
    const release = exact ?? (Object.hasOwn(this.state.releases, versionId) ? this.state.releases[versionId] : undefined);
    if (!release || release.bundleId !== bundleId) fail(`Release not found: ${bundleId}/${channelOrRelease}`, 'NOT_FOUND');
    return copy(release);
  }
  async getRelease(releaseId) {
    const release = Object.hasOwn(this.state.releases, releaseId) ? this.state.releases[releaseId] : undefined;
    if (!release) fail(`Unknown release: ${releaseId}`, 'NOT_FOUND');
    return copy(release);
  }
  async getArtifact(releaseId, target) {
    const release = await this.getRelease(releaseId);
    if (!Object.hasOwn(release.artifacts, target)) fail(`Artifact not found: ${target}`, 'NOT_FOUND');
    return release.artifacts[target];
  }
  async refresh() {
    const next = this.queue.then(async () => {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
      for (const name of ['listings', 'devices', 'sessions', 'receipts', 'submissions', 'builds']) this.state[name] ??= {};
      this.state.audit ??= [];
      return this;
    });
    this.queue = next.then(() => {}, () => {});
    return next;
  }
  async close() { await this.queue; }
  async health() { await readFile(this.file, 'utf8'); return { backend: 'file', status: 'ok' }; }
  async listDevices() { return Object.values(this.state.devices ?? {}).map(({ tokenHash, ...value }) => copy(value)); }
  async getDevice(id) {
    identifier(id, 'device id');
    const value = Object.hasOwn(this.state.devices ?? {}, id) ? this.state.devices[id] : undefined;
    if (!value) fail('Unknown device', 'NOT_FOUND');
    const { tokenHash, ...visible } = value;
    return copy(visible);
  }
  async registerDevice({ id, name, client, assignments = [] }) {
    identifier(id, 'device id'); requiredText(name, 'name');
    if (!TARGETS.includes(client)) fail('Unsupported client');
    stringArray(assignments, 'assignments').forEach(value => identifier(value, 'bundle id'));
    return this.mutate(state => {
      state.devices ??= {};
      for (const bundle of assignments) if (!Object.hasOwn(state.bundles, bundle)) fail('Unknown assigned bundle');
      const previous = state.devices[id];
      state.devices[id] = { ...previous, id, name, client, assignments: copy(assignments), updatedAt: new Date().toISOString() };
      audit(state, 'device.registered', id);
      const { tokenHash, ...visible } = state.devices[id];
      return visible;
    });
  }
  async issueDeviceToken(deviceId) {
    identifier(deviceId, 'device id');
    const token = `shd_${randomBytes(32).toString('hex')}`;
    return this.mutate(state => {
      if (!Object.hasOwn(state.devices ?? {}, deviceId)) fail('Unknown device', 'NOT_FOUND');
      state.devices[deviceId].tokenHash = createHash('sha256').update(token).digest('hex');
      state.devices[deviceId].tokenRevoked = false;
      audit(state, 'device.token-issued', deviceId);
      return { deviceId, token };
    });
  }
  async revokeDeviceToken(deviceId) {
    identifier(deviceId, 'device id');
    return this.mutate(state => {
      if (!Object.hasOwn(state.devices ?? {}, deviceId)) fail('Unknown device', 'NOT_FOUND');
      delete state.devices[deviceId].tokenHash;
      state.devices[deviceId].tokenRevoked = true;
      audit(state, 'device.token-revoked', deviceId);
      return { deviceId, revoked: true };
    });
  }
  async authenticateDeviceToken(raw) {
    if (typeof raw !== 'string' || !/^shd_[a-f0-9]{64}$/.test(raw)) return null;
    const hash = Buffer.from(createHash('sha256').update(raw).digest('hex'), 'hex');
    for (const value of Object.values(this.state.devices ?? {})) {
      if (!value.tokenRevoked && value.tokenHash && timingSafeEqual(hash, Buffer.from(value.tokenHash, 'hex'))) return { role: 'device', deviceId: value.id };
    }
    return null;
  }
  async bindSession({ id, deviceId, releaseIds, source = 'client-reported' }) {
    identifier(id, 'session id'); identifier(deviceId, 'device id');
    stringArray(releaseIds, 'releaseIds'); requiredText(source, 'source');
    if (!releaseIds.length) fail('Session must bind at least one release');
    return this.mutate(state => {
      state.sessions ??= {};
      const device = state.devices?.[deviceId];
      if (!device) fail('Unknown device', 'NOT_FOUND');
      const releases = releaseIds.map(id => {
        const release = Object.hasOwn(state.releases, id) ? state.releases[id] : undefined;
        if (!release) fail('Unknown release', 'NOT_FOUND');
        if (!device.assignments.includes(release.bundleId)) fail('Release is not assigned to device', 'FORBIDDEN');
        return release;
      });
      const value = { id, deviceId, releaseIds: copy(releaseIds), digest: digest(releases.map(r => ({ id: r.id, digest: r.digest }))), source, trusted: false };
      if (Object.hasOwn(state.sessions, id)) {
        const { createdAt, ...previous } = state.sessions[id];
        if (canonicalJson(previous) !== canonicalJson(value)) fail('Session binding is immutable', 'CONFLICT');
        return state.sessions[id];
      }
      state.sessions[id] = { ...value, createdAt: new Date().toISOString() };
      audit(state, 'session.bound', id);
      return state.sessions[id];
    });
  }
  async getSessionBinding(id) {
    identifier(id, 'session id');
    if (!Object.hasOwn(this.state.sessions ?? {}, id)) fail('Unknown session', 'NOT_FOUND');
    return copy(this.state.sessions[id]);
  }
  async listSessionBindings({ deviceId } = {}) { return copy(Object.values(this.state.sessions ?? {}).filter(item => !deviceId || item.deviceId === deviceId)); }
  async reportReceipt({ id, deviceId, sessionId, releaseId, kind, digest: declaredDigest, evidence, source = 'client-reported' }) {
    identifier(id, 'receipt id'); identifier(deviceId, 'device id');
    if (sessionId !== undefined) identifier(sessionId, 'session id');
    if (!['fetched', 'installed', 'injection_claim', 'injected', 'behavior'].includes(kind)) fail('Invalid receipt kind');
    requiredText(source, 'source');
    if (evidence !== undefined && (typeof evidence !== 'string' || Buffer.byteLength(evidence, 'utf8') > 16384)) fail('Evidence must be text of at most 16 KiB');
    if (declaredDigest !== undefined && (typeof declaredDigest !== 'string' || !/^[a-f0-9]{64}$/.test(declaredDigest))) fail('Invalid digest');
    return this.mutate(state => {
      state.receipts ??= {};
      const device = state.devices?.[deviceId];
      const release = Object.hasOwn(state.releases, releaseId) ? state.releases[releaseId] : undefined;
      if (!device || !release) fail('Unknown device or release', 'NOT_FOUND');
      if (!device.assignments.includes(release.bundleId)) fail('Release is not assigned to device', 'FORBIDDEN');
      if (sessionId) {
        const session = state.sessions?.[sessionId];
        if (!session || session.deviceId !== deviceId || !session.releaseIds.includes(releaseId)) fail('Receipt is outside session binding', 'FORBIDDEN');
      }
      if (declaredDigest && declaredDigest !== release.digest && !Object.values(release.artifacts).some(a => a.manifest.digest === declaredDigest)) fail('Receipt digest mismatch');
      const value = { id, deviceId, ...(sessionId ? { sessionId } : {}), releaseId, kind, ...(declaredDigest ? { digest: declaredDigest } : {}), ...(evidence === undefined ? {} : { evidence }), source, trusted: false, verification: 'unverified' };
      if (Object.hasOwn(state.receipts, id)) {
        const { receivedAt, ...previous } = state.receipts[id];
        if (canonicalJson(previous) !== canonicalJson(value)) fail('Receipt idempotency conflict', 'CONFLICT');
        return state.receipts[id];
      }
      state.receipts[id] = { ...value, receivedAt: new Date().toISOString() };
      audit(state, 'receipt.reported', id);
      return state.receipts[id];
    });
  }
  async listReceipts({ deviceId, sessionId } = {}) { return copy(Object.values(this.state.receipts ?? {}).filter(item => (!deviceId || item.deviceId === deviceId) && (!sessionId || item.sessionId === sessionId))); }
  async listAudit() { return copy(this.state.audit ?? []); }

}
