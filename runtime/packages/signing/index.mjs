import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

const domain = 'skill-hub/artifact-signature/v1';
function invalid(message) { const error = new Error(message); error.code = 'SIGNATURE_INVALID'; throw error; }
function publicKeyOf(key) { const result = key?.type === 'public' ? key : createPublicKey(key); if (result.asymmetricKeyType !== 'ed25519') invalid('Ed25519 public key required'); return result; }
export function signingKeyId(publicKey) { return createHash('sha256').update(publicKeyOf(publicKey).export({ type: 'spki', format: 'der' })).digest('hex'); }
export function generateSigningKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { keyId: signingKeyId(publicKey), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ type: 'spki', format: 'pem' }) };
}
function payload(artifact, releaseDigest, keyId) {
  if (!/^[a-f0-9]{64}$/.test(releaseDigest ?? '') || typeof keyId !== 'string' || !keyId) invalid('Release digest and key id required');
  if (!artifact?.manifest || typeof artifact.content !== 'string') invalid('Invalid artifact');
  const contentDigest = createHash('sha256').update(artifact.content).digest('hex');
  if (artifact.manifest.digest !== contentDigest) invalid('Artifact content digest mismatch');
  const artifactDigest = digest({ manifest: artifact.manifest, content: artifact.content });
  if (artifact.digest !== artifactDigest) invalid('Artifact digest mismatch');
  return { domain, schemaVersion: 1, keyId, releaseDigest, manifest: artifact.manifest, artifactDigest };
}
export function signArtifact(artifact, { releaseDigest, privateKey, keyId }) {
  const key = privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') invalid('Ed25519 private key required');
  keyId ??= signingKeyId(createPublicKey(key));
  const value = payload(artifact, releaseDigest, keyId);
  return { schemaVersion: 1, algorithm: 'Ed25519', keyId, releaseDigest, signature: sign(null, Buffer.from(canonicalJson(value)), key).toString('base64') };
}
export function verifyArtifactSignature(artifact, envelope, { trustedKeys, releaseDigest }) {
  try {
    if (envelope?.schemaVersion !== 1 || envelope.algorithm !== 'Ed25519' || envelope.releaseDigest !== releaseDigest) invalid('Invalid signature envelope');
    const trustedKey = trustedKeys instanceof Map ? trustedKeys.get(envelope.keyId) : Object.hasOwn(trustedKeys ?? {}, envelope.keyId) ? trustedKeys[envelope.keyId] : undefined;
    if (!trustedKey) invalid('Signing key is not trusted');
    if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) invalid('Invalid signature encoding');
    const value = payload(artifact, releaseDigest, envelope.keyId);
    if (!verify(null, Buffer.from(canonicalJson(value)), publicKeyOf(trustedKey), Buffer.from(envelope.signature, 'base64'))) invalid('Artifact signature verification failed');
    return { verified: true, keyId: envelope.keyId, releaseDigest };
  } catch (error) { if (error.code === 'SIGNATURE_INVALID') throw error; invalid('Invalid signature or key'); }
}
export function verifyReleaseSignatures(release, trustedKeys) {
  if (!release?.artifacts || !Object.keys(release.artifacts).length) invalid('Release has no artifacts');
  for (const [target, artifact] of Object.entries(release.artifacts)) {
    if (artifact.manifest.releaseId !== release.id || artifact.manifest.bundleId !== release.bundleId || artifact.manifest.version !== release.version || artifact.manifest.target !== target) invalid('Artifact does not belong to this release');
    verifyArtifactSignature(artifact, artifact.signature, { trustedKeys, releaseDigest: release.digest });
  }
  return true;
}
