import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digest } from '../packages/core/index.mjs';
import { generateSigningKeyPair, signArtifact, verifyArtifactSignature, verifyReleaseSignatures } from '../packages/signing/index.mjs';
function fixture() {
  const key = generateSigningKeyPair();
  const content = '{"skills":[]}';
  const artifact = { manifest: { releaseId: 'demo@1.0.0', bundleId: 'demo', version: '1.0.0', target: 'codex', digest: createHash('sha256').update(content).digest('hex') }, content };
  artifact.digest = digest(artifact);
  const releaseDigest = 'a'.repeat(64);
  const signature = signArtifact(artifact, { ...key, releaseDigest });
  return { key, artifact, releaseDigest, signature, options: { releaseDigest, trustedKeys: { [key.keyId]: key.publicKey } } };
}
test('Ed25519 signs artifact and verifies only trusted key against release digest', () => {
  const f = fixture();
  assert.equal(verifyArtifactSignature(f.artifact, f.signature, f.options).verified, true);
  const release = { id: 'demo@1.0.0', bundleId: 'demo', version: '1.0.0', digest: f.releaseDigest, artifacts: { codex: { ...f.artifact, signature: f.signature } } };
  assert.equal(verifyReleaseSignatures(release, f.options.trustedKeys), true);
  assert.throws(() => verifyReleaseSignatures({ ...release, id: 'other' }, f.options.trustedKeys), { code: 'SIGNATURE_INVALID' });
});
test('rejects tampered content even when attacker recomputes all hashes', () => {
  const f = fixture(); const changed = structuredClone(f.artifact); changed.content += 'x';
  changed.manifest.digest = createHash('sha256').update(changed.content).digest('hex');
  changed.digest = digest({ manifest: changed.manifest, content: changed.content });
  assert.throws(() => verifyArtifactSignature(changed, f.signature, f.options), { code: 'SIGNATURE_INVALID' });
});
test('rejects wrong key, untrusted key, release replacement and missing signature', () => {
  const f = fixture(); const wrong = generateSigningKeyPair();
  for (const options of [{ ...f.options, trustedKeys: {} }, { ...f.options, trustedKeys: { [f.key.keyId]: wrong.publicKey } }, { ...f.options, releaseDigest: 'b'.repeat(64) }]) assert.throws(() => verifyArtifactSignature(f.artifact, f.signature, options), { code: 'SIGNATURE_INVALID' });
  assert.throws(() => verifyArtifactSignature(f.artifact, null, f.options), { code: 'SIGNATURE_INVALID' });
});
test('canonical manifest ordering and signature excludes attached envelope', () => {
  const f = fixture(); const artifact = { ...f.artifact, manifest: Object.fromEntries(Object.entries(f.artifact.manifest).reverse()), signature: f.signature };
  assert.equal(verifyArtifactSignature(artifact, f.signature, f.options).verified, true);
});
