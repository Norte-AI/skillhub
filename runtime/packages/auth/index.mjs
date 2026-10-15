import { timingSafeEqual } from 'node:crypto';

function equal(a, b) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const STAFF_ROLES = ['editor', 'reviewer', 'publisher'];
const STAFF_READ = /^\/api\/(?:content|bundles|releases(?:\/[^/]+)?|submissions(?:\/[^/]+)?|builds(?:\/[^/]+)?|audit|marketplace(?:\/[^/]+)?)$/;
const STAFF_WRITE = {
  editor: /^\/api\/(?:submissions|content|bundles)$/,
  reviewer: /^\/api\/submissions\/[^/]+\/reviews$/,
  publisher: /^\/api\/(?:builds|releases|channels|marketplace\/(?:publish|unpublish)|git-marketplaces\/publish)$/,
};
/** Device authorization remains the server's assignment/session-specific responsibility. */
export function canAccess(identity, { method, path }) {
  if (!identity) return false;
  if (identity.role === 'admin' || identity.role === 'device') return true;
  if (!STAFF_ROLES.includes(identity.role) || typeof path !== 'string') return false;
  let pathname;
  try { pathname = new URL(path, 'http://localhost').pathname; } catch { return false; }
  if (method === 'GET') return STAFF_READ.test(pathname);
  if (method === 'POST') return STAFF_WRITE[identity.role].test(pathname);
  return false;
}
/** No anonymous remote administrator; device token hashes stay inside the store. */
export async function authenticate(req, { adminToken, staffTokens = {}, store, allowLocalAdmin = false }) {
  const staff = Object.fromEntries(STAFF_ROLES.map(role => [role, staffTokens[role] ?? process.env[`SKILLHUB_${role.toUpperCase()}_TOKEN`]]));
  const hasStaffToken = Object.values(staff).some(value => typeof value === 'string' && value.length);
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer ([^\s]+)$/.exec(header);
    if (!match) return null;
    if (typeof adminToken === 'string' && adminToken.length && equal(match[1], adminToken)) return { role: 'admin' };
    for (const role of STAFF_ROLES) {
      if (typeof staff[role] === 'string' && staff[role].length && equal(match[1], staff[role])) return { role };
    }
    await store.refresh?.();
    return store.authenticateDeviceToken(match[1]);
  }
  const remote = req.socket?.remoteAddress;
  if (!adminToken && !hasStaffToken && allowLocalAdmin && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return { role: 'admin' };
  return null;
}
