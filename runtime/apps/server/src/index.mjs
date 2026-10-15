import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { submitSkill, listSubmissions, getSubmission, reviewSubmission } from '../../../packages/review/index.mjs';
import { enqueueBuild, listBuilds, createBuildWorker, buildValidatedRelease } from '../../../packages/build/index.mjs';
import { canAccess } from '../../../packages/auth/index.mjs';
import { publishGitMarketplace } from '../../../packages/git-market/index.mjs';
import { withAuditActor } from '../../../packages/core/index.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const clients = new Set(['codex', 'kimi', 'zcode']);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const invalid = message => { throw new HttpError(400, message); };
const id = value => {
  if (typeof value !== 'string' || value.length > 256 || !/^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/.test(value) || Object.hasOwn(Object.prototype, value)) invalid('Invalid identifier');
  return value;
};
const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Request must be a JSON object'); return value; };
const string = (value, field) => { if (typeof value !== 'string' || !value.trim()) invalid(`${field} must be a non-empty string`); return value; };
const strings = (value, field, { optional = false } = {}) => {
  if (optional && value === undefined) return;
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string') || new Set(value).size !== value.length) invalid(`${field} must be an array of unique strings`);
};
function validate(input, fields) {
  object(input);
  for (const [field, type] of Object.entries(fields)) {
    const optional = type.endsWith('?'); const kind = optional ? type.slice(0, -1) : type;
    if (optional && input[field] === undefined) continue;
    if (kind === 'id') id(input[field]);
    if (kind === 'string') string(input[field], field);
    if (kind === 'strings') strings(input[field], field);
    if (kind === 'integer' && (!Number.isSafeInteger(input[field]) || input[field] < 0)) invalid(`${field} must be a non-negative integer`);
  }
  return input;
}
async function readBody(req, maxBodyBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Content-Type must be application/json');
  const chunks = []; let size = 0; let oversized = false;
  // Drain the request rather than destroy its socket: clients must receive the 413 response.
  for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) oversized = true; else if (!oversized) chunks.push(chunk); }
  if (oversized) throw new HttpError(413, 'Request body is too large');
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON'); }
}
function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (['NOT_FOUND', 'NOT_FOUND_ERROR'].includes(error.code)) return 404;
  if (['CONFLICT', 'CONFLICT_ERROR', 'CAS_CONFLICT', 'DUPLICATE'].includes(error.code)) return 409;
  if (error.code === 'VALIDATION_ERROR') {
    if (/already (?:published|exists)|generation.*(?:mismatch|conflict)|conflict/i.test(error.message)) return 409;
    if (/unknown (?:bundle|release|listing|device|session)|release not found|artifact not found|missing content/i.test(error.message)) return 404;
    return 400;
  }
  if (error.code === 'AUTHENTICATION_REQUIRED' || error.code === 'UNAUTHORIZED') return 401;
  if (error.code === 'FORBIDDEN') return 403;
  return 500;
}
function page(values, url) {
  if (!url.searchParams.has('limit') && !url.searchParams.has('cursor')) return values;
  const rawLimit = url.searchParams.get('limit') ?? '50'; const rawCursor = url.searchParams.get('cursor') ?? '0';
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawCursor)) invalid('Invalid pagination');
  const limit = Number(rawLimit), offset = Number(rawCursor);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) invalid('Invalid pagination');
  return { items: values.slice(offset, offset + limit), nextCursor: offset + limit < values.length ? String(offset + limit) : null };
}
export async function createServer({ store: suppliedStore, dataDir = resolve('.skillhub-data'), databaseUrl = process.env.SKILLHUB_DATABASE_URL, token = process.env.SKILLHUB_TOKEN, authenticate: authenticateOverride, staffTokens, allowLocalAdmin = true, maxBodyBytes = 1024 * 1024, handleMcpRequest: mcpOverride, logger, allowedHosts = (process.env.SKILLHUB_ALLOWED_HOSTS || '127.0.0.1,localhost,[::1]').split(',').map(host => host.trim()).filter(Boolean), gitAllowRemote = process.env.SKILLHUB_GIT_ALLOW_REMOTE === '1', signingKey, webRoot = fileURLToPath(new URL('../../web/', import.meta.url)), gitRootDir = resolve(process.env.SKILLHUB_GIT_ROOT || '.skillhub-git') } = {}) {
  const store = suppliedStore ?? await (await import('../../../packages/storage/index.mjs')).createStore({ dataDir, databaseUrl, signingKey });
  await store.init();
  const worker = createBuildWorker(store);
  const authenticate = authenticateOverride ?? (await import('../../../packages/auth/index.mjs')).authenticate;
  let gitHandlerPromise;
  let registryImportQueue = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID(); const started = performance.now();
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => {
      try { logger?.({ requestId, method: req.method, path: new URL(req.url, 'http://localhost').pathname, status: res.statusCode, durationMs: Math.round(performance.now() - started) }); } catch { /* Logging must not break requests. */ }
    });
    const send = (status, value) => {
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      let authority;
      try { authority = new URL(`http://${req.headers.host}`); } catch { throw new HttpError(400, 'Invalid Host header'); }
      if (authority.username || authority.password || authority.pathname !== '/' || !allowedHosts.includes(authority.hostname)) throw new HttpError(403, 'Host is not allowed');
      if (req.headers.origin) {
        let origin; try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Cross-origin requests are not accepted'); }
        if (origin.host !== req.headers.host) throw new HttpError(403, 'Cross-origin requests are not accepted');
      }
      if (url.pathname === '/git' || url.pathname.startsWith('/git/')) {
        gitHandlerPromise ??= import('../../../packages/git-http/index.mjs').then(module => module.createGitHttpHandler({ rootDir: gitRootDir, prefix: '/git', allowRemote: gitAllowRemote }));
        const handler = await gitHandlerPromise;
        if (await handler(req, res)) return;
        return send(404, { error: 'Git repository not found' });
      }
      if (url.pathname === '/health' && req.method === 'GET') return send(200, { status: 'ok' });
      if (url.pathname === '/ready' && req.method === 'GET') {
        try { if (store.health) await store.health(); else await store.listBundles(); return send(200, { status: 'ready' }); }
        catch { return send(503, { status: 'unavailable' }); }
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/assets/app.js': ['app.js', 'text/javascript'], '/assets/style.css': ['style.css', 'text/css'] };
      if (Object.hasOwn(staticFiles, url.pathname) && ['GET', 'HEAD'].includes(req.method)) {
        const [file, mime] = staticFiles[url.pathname];
        const body = await readFile(resolve(webRoot, file));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'Referrer-Policy': 'no-referrer' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const identity = await authenticate(req, { adminToken: token, staffTokens, store, allowLocalAdmin });
      if (!identity) throw new HttpError(401, 'Authentication required');
      if (!canAccess(identity, { method: req.method, path: url.pathname })) throw new HttpError(403, 'Role is not permitted to perform this action');
      const admin = ['admin', 'editor', 'reviewer', 'publisher'].includes(identity.role);
      if (!admin && identity.role !== 'device') throw new HttpError(403, 'Access denied');
      return await withAuditActor({ role: identity.role, ...(identity.role === 'admin' && token && req.headers.authorization === `Bearer ${token}` && req.headers['x-skillhub-actor'] ? { userId: String(req.headers['x-skillhub-actor']).slice(0, 128) } : {}), ...(identity.deviceId ? { deviceId: identity.deviceId } : {}) }, async () => {
        const device = admin ? null : await store.getDevice(identity.deviceId);
        const assigned = new Set(device?.assignments ?? []);
        const allowBundle = bundleId => { if (!admin && !assigned.has(bundleId)) throw new HttpError(403, 'Bundle is not assigned to this device'); };
        const allowRelease = async releaseId => { const release = await store.getRelease(id(releaseId)); allowBundle(release.bundleId); return release; };
        const requireAdmin = () => { if (!admin) throw new HttpError(403, 'Administrator access required'); };
        const ownDevice = input => { if (!admin) { if (input.deviceId !== undefined && input.deviceId !== identity.deviceId) throw new HttpError(403, 'Device identity mismatch'); input.deviceId = identity.deviceId; } id(input.deviceId); };
        const parts = url.pathname.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { invalid('Invalid URL encoding'); } });
        if (url.pathname === '/mcp') {
          const handler = mcpOverride ?? (await import('../../mcp/src/index.mjs')).handleMcpRequest;
          return await handler(req, res, { store, identity, maxBodyBytes });
        }
        if (req.method === 'GET') {
          if (url.pathname === '/api/submissions') { requireAdmin(); return send(200, page(await listSubmissions(store, { status: url.searchParams.get('status') || undefined }), url)); }
          if (parts[0] === 'api' && parts[1] === 'submissions' && parts.length === 3) { requireAdmin(); return send(200, await getSubmission(store, id(parts[2]))); }
          if (url.pathname === '/api/builds') { requireAdmin(); return send(200, page(await listBuilds(store), url)); }

          if (url.pathname === '/api/content') { requireAdmin(); return send(200, page(await store.listContent(), url)); }
          if (url.pathname === '/api/bundles') return send(200, page((await store.listBundles()).filter(b => admin || assigned.has(b.id)), url));
          if (url.pathname === '/api/marketplace') return send(200, page((await store.listListings({ query: url.searchParams.get('q') || undefined, target: url.searchParams.get('target') || undefined })).filter(b => admin || assigned.has(b.bundleId)), url));
          if (parts[0] === 'api' && parts[1] === 'marketplace' && parts.length === 3) { allowBundle(id(parts[2])); return send(200, await store.getListing(parts[2])); }
          if (url.pathname === '/api/releases') {
            const bundleId = url.searchParams.get('bundle') || undefined; if (bundleId) { id(bundleId); allowBundle(bundleId); }
            return send(200, page((await store.listReleases(bundleId)).filter(r => admin || assigned.has(r.bundleId)), url));
          }
          if (parts[0] === 'api' && parts[1] === 'releases' && parts.length === 3) return send(200, await allowRelease(parts[2]));
          if (url.pathname === '/api/resolve') { const bundleId = id(url.searchParams.get('bundle')); allowBundle(bundleId); return send(200, await store.resolveRelease(bundleId, id(url.searchParams.get('ref') || 'stable'))); }
          if (parts[0] === 'api' && parts[1] === 'artifacts' && parts.length === 4) { if (!clients.has(parts[3])) invalid('Unsupported client'); await allowRelease(parts[2]); return send(200, await store.getArtifact(parts[2], parts[3])); }
          if (url.pathname === '/api/devices') { requireAdmin(); return send(200, page((await store.listDevices()).map(publicDevice), url)); }
          if (url.pathname === '/api/sessions') return send(200, page((await store.listSessionBindings()).filter(s => admin || s.deviceId === identity.deviceId), url));
          if (url.pathname === '/api/receipts') {
            const deviceId = admin ? url.searchParams.get('deviceId') || undefined : identity.deviceId;
            if (deviceId) id(deviceId); const sessionId = url.searchParams.get('sessionId') || undefined; if (sessionId) id(sessionId);
            return send(200, page(await store.listReceipts({ deviceId, sessionId }), url));
          }
          if (url.pathname === '/api/audit') { requireAdmin(); return send(200, page(await store.listAudit(), url)); }
        }
        if (req.method === 'POST') {
          // Device write capabilities are restricted to its own telemetry.
          if (!['/api/sessions', '/api/receipts'].includes(url.pathname)) requireAdmin();
          if (parts[0] === 'api' && parts[1] === 'devices' && parts.length === 4 && ['token', 'revoke'].includes(parts[3])) {
            req.resume();
            return parts[3] === 'token' ? send(201, await store.issueDeviceToken(id(parts[2]))) : send(200, await store.revokeDeviceToken(id(parts[2])));
          }
          const input = await readBody(req, url.pathname === '/internal/registry-import' ? 24 * 1024 * 1024 : maxBodyBytes);
          if (url.pathname === '/internal/registry-import') {
            if (identity.role !== 'admin' || !token || req.headers.authorization !== `Bearer ${token}` || !req.headers['x-skillhub-actor']) throw new HttpError(403, 'Registry service authentication required');
            validate(input, { id: 'id', title: 'string', body: 'string' });
            const source = input.source;
            if (!source || typeof source.namespace !== 'string' || typeof source.slug !== 'string' || typeof source.version !== 'string' || !/^[a-f0-9]{64}$/.test(source.packageSha256 ?? '')) invalid('Invalid registry source');
            if (!Array.isArray(input.resources) || input.resources.some(r => !r || typeof r.path !== 'string' || typeof r.body !== 'string' || r.path.toLowerCase() === '.skillhub-registry.json')) invalid('Invalid registry resources');
            const operation = registryImportQueue.then(async () => {
              const existing = (await store.listContent()).find(item => item.id === input.id);
              if (existing) {
                const provenance = existing.resources.find(resource => resource.path === '.skillhub-registry.json');
                let recorded; try { recorded = JSON.parse(provenance?.body ?? 'null'); } catch { recorded = null; }
                if (!recorded || ['namespace', 'slug', 'version', 'packageSha256'].some(key => recorded[key] !== source[key])) throw new HttpError(409, 'Registry version is immutable or content id is occupied');
                return { contentId: existing.id, revision: existing.revision, digest: existing.digest, source };
              }
              const item = await store.saveContent({ id: input.id, kind: 'skill', title: input.title, body: input.body,
                resources: [...input.resources, { path: '.skillhub-registry.json', body: JSON.stringify(source) }] });
              return { contentId: item.id, revision: item.revision, digest: item.digest, source };
            });
            registryImportQueue = operation.catch(() => {});
            return send(200, await operation);
          }
          if (url.pathname === '/api/submissions') return send(201, await submitSkill(store, input, identity));
          if (parts[0] === 'api' && parts[1] === 'submissions' && parts.length === 4 && parts[3] === 'reviews') return send(200, await reviewSubmission(store, id(parts[2]), input, identity));
          if (url.pathname === '/api/builds') { validate(input, { bundleId: 'id', version: 'string' }); const job = await enqueueBuild(store, input, identity); worker.kick(); return send(202, job); }
          if (url.pathname === '/api/git-marketplaces/publish') {
            if (!['codex', 'zcode'].includes(input.target)) invalid('Git target must be codex or zcode');
            return send(201, await publishGitMarketplace({ store, target: input.target, outDir: resolve(gitRootDir, `${input.target}.git`) }));
          }

          if (url.pathname === '/api/content') {
            validate(input, { id: 'id', kind: 'string', title: 'string', body: 'string' });
            if (identity.role === 'editor' && input.kind === 'skill') throw new HttpError(403, 'Skills must be submitted for review');
            if (!['rule', 'role', 'skill'].includes(input.kind)) invalid('Invalid content kind');
            if (input.dependencies !== undefined) strings(input.dependencies, 'dependencies');
            if (input.resources !== undefined && (!Array.isArray(input.resources) || input.resources.some(r => !r || Array.isArray(r) || typeof r.path !== 'string' || typeof r.body !== 'string'))) invalid('Invalid resources');
            return send(201, await store.saveContent(input));
          }
          if (url.pathname === '/api/bundles') { validate(input, { id: 'id', name: 'string', items: 'strings', targets: 'strings?', tags: 'strings?' }); if (input.description !== undefined && typeof input.description !== 'string') invalid('Invalid description'); return send(201, await store.saveBundle(input)); }
          if (url.pathname === '/api/releases') { validate(input, { bundleId: 'id', version: 'string' }); return send(201, await buildValidatedRelease(store, input.bundleId, input.version)); }
          if (url.pathname === '/api/channels') { validate(input, { bundleId: 'id', channel: 'id', releaseId: 'id', expectedGeneration: 'integer?' }); return send(200, await store.setChannel(input.bundleId, input.channel, input.releaseId, { expectedGeneration: input.expectedGeneration })); }
          if (url.pathname === '/api/marketplace/publish') { validate(input, { bundleId: 'id', releaseId: 'id' }); if (input.visibility !== undefined && !['private', 'public'].includes(input.visibility)) invalid('Invalid visibility'); return send(201, await store.publishListing({ ...input, visibility: input.visibility ?? 'private' })); }
          if (url.pathname === '/api/marketplace/unpublish') { validate(input, { bundleId: 'id' }); return send(200, await store.unpublishListing(input.bundleId)); }
          if (url.pathname === '/api/devices') { validate(input, { id: 'id', name: 'string', client: 'string', assignments: 'strings?' }); if (!clients.has(input.client)) invalid('Unsupported client'); return send(201, publicDevice(await store.registerDevice(input))); }
                  if (url.pathname === '/api/sessions') { validate(input, { id: 'id', releaseIds: 'strings', source: 'string?' }); if (!admin) input.source = 'client-reported'; ownDevice(input); for (const releaseId of input.releaseIds) await allowRelease(releaseId); return send(201, await store.bindSession(input)); }
          if (url.pathname === '/api/receipts') {
            validate(input, { id: 'id', releaseId: 'id', kind: 'string', sessionId: 'id?', digest: 'string?', evidence: 'string?', source: 'string?' }); if (!admin) { if (!['fetched', 'installed', 'injection_claim'].includes(input.kind)) throw new HttpError(403, 'Receipt kind is not permitted for devices'); input.source = 'client-reported'; } ownDevice(input); await allowRelease(input.releaseId);
            if (!admin && input.sessionId) { const session = (await store.listSessionBindings()).find(s => s.id === input.sessionId); if (!session || session.deviceId !== identity.deviceId) throw new HttpError(403, 'Session does not belong to this device'); }
            return send(201, await store.reportReceipt(input));
          }
        }
        send(404, { error: 'Route not found' });
      });
    } catch (error) {
      const status = errorStatus(error);
      send(status, { error: status === 500 ? 'Internal server error' : status === 401 ? 'Authentication required' : error.message });
    }
  });
  let closePromise;
  const close = () => closePromise ??= (async () => { await worker.close(); if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); await store.close?.(); })();
  return { server, store, close };
}
function publicDevice(device) {
  return Object.fromEntries(['id', 'name', 'client', 'assignments', 'status', 'createdAt', 'updatedAt', 'tokenIssuedAt', 'tokenRevokedAt', 'tokenRevoked'].filter(key => device[key] !== undefined).map(key => [key, device[key]]));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.SKILLHUB_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.SKILLHUB_TOKEN) throw new Error('A token is required for non-loopback binding');
  const signingKey = process.env.SKILLHUB_SIGNING_KEY_FILE ? { privateKey: await readFile(resolve(process.env.SKILLHUB_SIGNING_KEY_FILE), 'utf8') } : undefined;
  const app = await createServer({ signingKey, dataDir: resolve(process.env.SKILLHUB_DATA_DIR || '.skillhub-data'), allowLocalAdmin: ['127.0.0.1', '::1', 'localhost'].includes(host), logger: event => console.log(JSON.stringify(event)) });
  app.server.listen(Number(process.env.PORT || 4317), host, () => console.log(`Skill Hub API: http://${host}:${app.server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }));
}
