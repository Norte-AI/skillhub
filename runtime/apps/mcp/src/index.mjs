#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from '../../../packages/storage/index.mjs';
import { withAuditActor } from '../../../packages/core/index.mjs';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const id = z.string().min(1).max(256);
const target = z.enum(['codex', 'kimi', 'zcode']);
export function createMcpServer(store, { identity = { role: 'admin', source: 'local-stdio' } } = {}) {
  const server = new McpServer({ name: 'skill-hub', version: '0.1.0' }, {
    instructions: 'Resolve a bundle once, then use its fixed releaseId for subsequent reads. Resources and load_bundle are manual reference entry points; delivery and self-reported receipts do not prove Agent configuration injection or actual session loading.'
  });
  const refresh = async () => { await store.refresh?.(); };
  async function assignments() {
    if (identity?.role === 'admin') return null;
    if (identity?.role !== 'device' || !identity.deviceId) throw new Error('Unauthenticated identity');
    if (store.getDevice) {
      const device = await store.getDevice(identity.deviceId);
      if (!device || device.disabled || device.status === 'disabled') throw new Error('Device access denied');
      return device.assignments ?? [];
    }
    return identity.assignments ?? [];
  }
  async function authorize(bundleId) {
    const allowed = await assignments();
    if (allowed && !allowed.includes(bundleId)) throw new Error('Bundle access denied');
  }
  async function releaseFor(releaseId) {
    const release = await store.getRelease(releaseId);
    await authorize(release.bundleId);
    return release;
  }
  async function contentFor(releaseId, client, contentId) {
    await releaseFor(releaseId);
    const artifact = await store.getArtifact(releaseId, client);
    const items = JSON.parse(artifact.content);
    const selected = contentId ? items.filter(item => item.id === contentId) : items;
    if (contentId && !selected.length) throw new Error(`Content not found in release: ${contentId}`);
    return { releaseId, manifest: artifact.manifest, items: selected };
  }
  function register(name, description, inputSchema, handler, readOnly = true) {
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false } }, async args => {
      try {
        await refresh();
        return text(await withAuditActor({ role: identity.role, ...(identity.deviceId ? { deviceId: identity.deviceId } : {}) }, () => handler(args)));
      }
      catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message, code: error.code ?? 'TOOL_ERROR' }) }] }; }
    });
  }
  register('resolve_bundle', 'Resolve channel or version to a fixed immutable release. Call once per session.', { bundleId: id, ref: id.default('stable') }, async ({ bundleId, ref }) => {
    await authorize(bundleId);
    const release = await store.resolveRelease(bundleId, ref);
    return { releaseId: release.id, bundleId: release.bundleId, version: release.version, digest: release.digest, items: release.items };
  });
  register('get_bundle', 'Read a bundle snapshot by fixed releaseId.', { releaseId: id }, async ({ releaseId }) => {
    const release = await releaseFor(releaseId);
    return { releaseId: release.id, bundle: release.bundle, items: release.items, version: release.version, digest: release.digest };
  });
  register('get_content', 'Read immutable content from a release. Optional contentId selects one item.', { releaseId: id, target: target.default('codex'), contentId: id.optional() }, async ({ releaseId, target, contentId }) => {
    return contentFor(releaseId, target, contentId);
  });
  register('get_release_diff', 'Compare immutable releases of the same bundle; reports added, removed and changed content identifiers.', { fromReleaseId: id, toReleaseId: id }, async ({ fromReleaseId, toReleaseId }) => {
    const [from, to] = await Promise.all([releaseFor(fromReleaseId), releaseFor(toReleaseId)]);
    if (from.bundleId !== to.bundleId) throw new Error('Cannot compare releases from different bundles');
    const before = new Map(from.items.map(item => [item.id, item]));
    const after = new Map(to.items.map(item => [item.id, item]));
    return { fromReleaseId, toReleaseId, bundleId: from.bundleId,
      added: to.items.filter(item => !before.has(item.id)).map(item => item.id),
      removed: from.items.filter(item => !after.has(item.id)).map(item => item.id),
      changed: to.items.filter(item => before.has(item.id) && before.get(item.id).digest !== item.digest).map(item => ({ id: item.id, fromRevision: before.get(item.id).revision, toRevision: item.revision })),
      bundleChanged: JSON.stringify(from.bundle) !== JSON.stringify(to.bundle)
    };
  });
  register('report_receipt', 'Record an untrusted client declaration, never verified injection or behavior evidence.', {
    id: id.optional(), deviceId: id.optional(), sessionId: id.optional(), releaseId: id,
    kind: z.enum(['fetched', 'installed', 'injection_claim']), digest: id.optional(), evidence: z.string().max(10000).optional()
  }, async args => {
    await releaseFor(args.releaseId);
    const deviceId = identity.role === 'device' ? identity.deviceId : args.deviceId;
    if (!deviceId || (identity.role === 'device' && args.deviceId && args.deviceId !== deviceId)) throw new Error('Receipt device identity mismatch');
    if (!store.reportReceipt) throw new Error('Receipt storage is unavailable');
    const receipt = await store.reportReceipt({ ...args, id: args.id ?? randomUUID(), deviceId, source: 'mcp-self-report', trusted: false });
    return { ...receipt, trusted: false, verification: 'self-reported' };
  }, false);
  server.registerResource('release-manifest', new ResourceTemplate('skillhub://releases/{releaseId}/manifest', { list: undefined }), { description: 'Immutable release manifest', mimeType: 'application/json' }, async (uri, { releaseId }) => {
    await refresh();
    const release = await releaseFor(decodeURIComponent(releaseId));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ releaseId: release.id, bundleId: release.bundleId, version: release.version, digest: release.digest, items: release.items }) }] };
  });
  server.registerResource('release-content', new ResourceTemplate('skillhub://releases/{releaseId}/content/{contentId}', { list: undefined }), { description: 'Immutable release content', mimeType: 'application/json' }, async (uri, { releaseId, contentId }) => {
    await refresh();
    const release = await releaseFor(decodeURIComponent(releaseId));
    const availableTarget = Object.keys(release.artifacts)[0];
    const result = await contentFor(release.id, availableTarget, decodeURIComponent(contentId));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(result) }] };
  });
  server.registerPrompt('load_bundle', { description: 'Manual entry point to read a fixed release. This prompt does not automatically inject rules.', argsSchema: { bundleId: id, ref: id.optional() } }, async ({ bundleId, ref = 'stable' }) => {
    await refresh(); await authorize(bundleId);
    const release = await store.resolveRelease(bundleId, ref);
    const result = await contentFor(release.id, Object.keys(release.artifacts)[0]);
    return { description: 'Manually requested bundle reference; no injection guarantee', messages: [{ role: 'user', content: { type: 'text', text: `Manual reference for fixed release ${release.id}. Keep this releaseId for subsequent reads. Content delivery is not verified configuration injection.\n${JSON.stringify(result)}` } }] };
  });
  return server;
}

/** HTTP mounting boundary: caller authenticates every request before passing identity. */
export async function handleMcpRequest(req, res, { store, identity, maxBodyBytes = 1024 * 1024 }) {
  if (!identity || !['admin', 'device'].includes(identity.role) || (identity.role === 'device' && !identity.deviceId)) {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'Authentication required' })); return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Stateless MCP supports POST only' })); return;
  }
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    res.writeHead(415, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'application/json is required' })); return;
  }
  try {
    if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw Object.assign(new Error('Invalid body size limit'), { status: 500 });
    if (req.body !== undefined) {
      if (Buffer.byteLength(JSON.stringify(req.body)) > maxBodyBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    } else {
      const raw = await new Promise((resolveBody, rejectBody) => {
        const chunks = []; let bytes = 0;
        const finish = (error, value) => {
          clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted);
          if (error) { req.resume(); rejectBody(error); } else resolveBody(value);
        };
        const data = chunk => { bytes += chunk.length; if (bytes > maxBodyBytes) finish(Object.assign(new Error('Request body too large'), { status: 413 })); else chunks.push(chunk); };
        const end = () => finish(null, Buffer.concat(chunks).toString('utf8'));
        const failed = error => finish(error);
        const aborted = () => finish(Object.assign(new Error('Request aborted'), { status: 400 }));
        const timer = setTimeout(() => finish(Object.assign(new Error('Request body timeout'), { status: 408 })), 15000); timer.unref();
        req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
      });
      try { req.body = JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
    }
  } catch (error) {
    res.writeHead(error.status ?? 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); return;
  }
  const server = createMcpServer(store, { identity });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const close = () => { server.close().catch(() => {}); };
  res.once('close', close);
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (error) {
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'MCP request failed' })); }
    else if (!res.writableEnded) res.end();
  }
  finally { res.off('close', close); await server.close(); }
}
export function createMcpHttpHandler({ store, authenticate, maxBodyBytes }) {
  if (typeof authenticate !== 'function') throw new Error('MCP authenticate callback is required');
  return async (req, res) => {
    let identity;
    try { identity = await authenticate(req); } catch { identity = null; }
    return handleMcpRequest(req, res, { store, identity, maxBodyBytes });
  };
}
export async function start({ dataDir = process.env.SKILLHUB_DATA_DIR || resolve('.skillhub-data') } = {}) {
  const store = await createStore({ databaseUrl: process.env.SKILLHUB_DATABASE_URL, dataDir }).init();
  const server = createMcpServer(store);
  server.server.onclose = () => { Promise.resolve(store.close?.()).catch(() => { console.error('MCP storage shutdown failed'); }); };
  try { await server.connect(new StdioServerTransport()); }
  catch (error) { await store.close?.(); throw error; }
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(error => { console.error(error.message); process.exitCode = 1; });
}
