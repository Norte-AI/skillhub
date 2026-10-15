import { randomUUID } from 'node:crypto';
import { digest } from '../core/index.mjs';

const clone = value => structuredClone(value);
function fail(message, code = 'VALIDATION_ERROR') { throw Object.assign(new Error(message), { code }); }
function identifier(value, name) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || Object.hasOwn(Object.prototype, value)) fail(`Invalid ${name}`);
  return value;
}
function text(value, name, max = 1024 * 1024) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > max) fail(`Invalid ${name}`);
  return value.replace(/\r\n?/g, '\n').normalize('NFC');
}
function actorIdentity(actor, permitted) {
  if (!actor || !permitted.includes(actor.role)) fail('Administrator authentication required', 'FORBIDDEN');
  return { role: actor.role, id: actor.id ?? actor.role };
}
function event(state, action, objectId, actor) {
  state.audit ??= [];
  state.audit.push({ id: randomUUID(), action, objectId, actor, timestamp: new Date().toISOString() });
}
function get(state, id) {
  identifier(id, 'submission id');
  if (!Object.hasOwn(state.submissions ?? {}, id)) fail('Submission not found', 'NOT_FOUND');
  return state.submissions[id];
}
export function validateSkillUpload(input) {
  if (!input || typeof input !== 'object') fail('Skill upload must be an object');
  const id = identifier(input.contentId, 'content id');
  const body = text(input.body, 'SKILL.md body');
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) fail('SKILL.md requires YAML frontmatter with name and description');
  // These required scalar fields deliberately accept only single-line strings.
  const scalar = key => {
    const value = frontmatter[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    if (!value || /^[>|[{]/.test(value)) fail(`SKILL.md requires a single-line ${key}`);
    return value.replace(/^(['"])(.*)\1$/, '$2').trim();
  };
  const name = scalar('name');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) fail('Skill name must be lowercase kebab-case, at most 64 characters');
  text(scalar('description'), 'skill description', 1024);
  const title = text(input.title ?? name, 'title', 256);
  const resources = input.resources ?? [];
  if (!Array.isArray(resources) || resources.length > 128) fail('At most 128 text resources are supported');
  const seen = new Set(['SKILL.md']);
  let bytes = Buffer.byteLength(body);
  const normalized = resources.map(resource => {
    const path = resource?.path;
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(path)) fail('Invalid or duplicate resource path');
    seen.add(path);
    if (typeof resource.body !== 'string') fail('Resource body must be text');
    const body = resource.body.replace(/\r\n?/g, '\n').normalize('NFC');
    bytes += Buffer.byteLength(body);
    return { path, body };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (bytes > 2 * 1024 * 1024) fail('Skill upload exceeds 2 MiB');
  let dependencies;
  if (input.dependencies !== undefined) {
    if (!Array.isArray(input.dependencies)) fail('dependencies must be an array');
    dependencies = input.dependencies.map(value => identifier(value, 'dependency id'));
    if (new Set(dependencies).size !== dependencies.length) fail('dependencies must contain unique ids');
  }
  return { id, kind: 'skill', title, body, resources: normalized, ...(dependencies === undefined ? {} : { dependencies }) };
}
export async function submitSkill(store, input, actor) {
  const submittedBy = actorIdentity(actor, ['admin', 'editor']);
  const payload = validateSkillUpload(input);
  const id = input.id === undefined ? randomUUID() : identifier(input.id, 'submission id');
  return store.mutate(state => {
    state.submissions ??= {};
    if (Object.hasOwn(state.submissions, id)) fail('Submission id already exists; resubmit with a new id', 'CONFLICT');
    const submission = { id, contentId: payload.id, payload, digest: digest(payload), status: 'pending', submittedBy, submittedAt: new Date().toISOString() };
    state.submissions[id] = submission;
    event(state, 'skill.submitted', id, submittedBy);
    return submission;
  });
}
async function snapshot(store) { return typeof store.readSnapshot === 'function' ? store.readSnapshot() : store.state; }
export async function listSubmissions(store, { status } = {}) {
  if (status !== undefined && !['pending', 'approved', 'rejected'].includes(status)) fail('Invalid submission status');
  return clone(Object.values((await snapshot(store)).submissions ?? {}).filter(item => !status || item.status === status));
}
export async function getSubmission(store, id) { return clone(get(await snapshot(store), id)); }
export async function reviewSubmission(store, id, input, actor) {
  const reviewedBy = actorIdentity(actor, ['admin', 'reviewer']);
  if (!['approve', 'reject'].includes(input?.decision)) fail('Decision must be approve or reject');
  const comment = text(input.comment, 'review comment', 16384);
  return store.mutate(state => {
    const item = get(state, id);
    if (item.status !== 'pending') fail('Submission has already been reviewed', 'CONFLICT');
    if (digest(item.payload) !== item.digest) fail('Submission integrity check failed', 'CONFLICT');
    if (input.decision === 'approve') {
      const history = state.content[item.contentId] ??= [];
      const revision = { ...clone(item.payload), submissionId: item.id, revision: history.length + 1 };
      // Digest includes submission provenance, matching core saveContent's payload convention.
      const { revision: number, ...payload } = revision;
      revision.digest = digest(payload);
      history.push(revision);
      item.approvedRevision = number;
      item.approvedDigest = revision.digest;
    }
    Object.assign(item, { status: input.decision === 'approve' ? 'approved' : 'rejected', comment, reviewedBy, reviewedAt: new Date().toISOString() });
    event(state, `skill.${item.status}`, id, reviewedBy);
    return item;
  });
}
/** Called inside release construction's transaction before locking latest content. */
export function assertReleaseApproved(state, bundle) {
  for (const id of bundle.items) {
    const revision = state.content[id]?.at(-1);
    const managed = Object.values(state.submissions ?? {}).some(item => item.contentId === id);
    if (!managed) continue; // Existing trusted administrator authoring remains supported.
    if (!revision?.submissionId) fail('Reviewed skills require an approved revision', 'FORBIDDEN');
    const submission = get(state, revision.submissionId);
    if (submission.status !== 'approved' || submission.contentId !== id || submission.approvedRevision !== revision.revision || submission.approvedDigest !== revision.digest) fail('Skill revision is not approved for publication', 'FORBIDDEN');
  }
}
