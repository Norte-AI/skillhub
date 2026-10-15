// A quiescent synthetic snapshot only; no production paths are accepted.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HubStore } from '../packages/core/index.mjs';
import { generateSigningKeyPair, verifyReleaseSignatures } from '../packages/signing/index.mjs';
import { publishGitMarketplace } from '../packages/git-market/index.mjs';
const dir = await mkdtemp(join(tmpdir(), 'skillhub-restore-drill-'));
try {
  const source = join(dir, 'source'), backup = join(dir, 'backup'), restored = join(dir, 'restored');
  await mkdir(source);
  const key = generateSigningKeyPair();
  await writeFile(join(source, 'signing-key.json'), JSON.stringify(key), { mode: 0o600 });
  const store = await new HubStore({ dataDir: join(source, 'data'), signingKey: key }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Recovery', body: 'Fixed recovery rules' });
  await store.saveBundle({ id: 'recovery', name: 'Recovery', items: ['rule'], targets: ['codex'] });
  const release = await store.buildRelease('recovery', '1.0.0');
  await store.setChannel('recovery', 'stable', release.id);
  await store.publishListing({ bundleId: 'recovery', releaseId: release.id });
  await store.registerDevice({ id: 'fixture', name: 'Recovery fixture', client: 'codex', assignments: ['recovery'] });
  const { token } = await store.issueDeviceToken('fixture');
  await store.bindSession({ id: 'fixture-session', deviceId: 'fixture', releaseIds: [release.id] });
  await store.reportReceipt({ id: 'fixture-receipt', deviceId: 'fixture', sessionId: 'fixture-session', releaseId: release.id, kind: 'fetched', digest: release.digest });
  await store.revokeDeviceToken('fixture');
  const market = await publishGitMarketplace({ store, outDir: join(source, 'codex.git') });
  // All writers are idle for the shared backup window.
  await cp(source, backup, { recursive: true });
  await rm(source, { recursive: true });
  await cp(backup, restored, { recursive: true });
  const recoveredKey = JSON.parse(await readFile(join(restored, 'signing-key.json'), 'utf8'));
  const recovered = await new HubStore({ dataDir: join(restored, 'data'), signingKey: recoveredKey }).init();
  assert.deepEqual(await recovered.getRelease(release.id), release);
  assert.equal(verifyReleaseSignatures(await recovered.getRelease(release.id), { [key.keyId]: key.publicKey }), true);
  assert.equal((await recovered.resolveRelease('recovery')).id, release.id);
  assert.equal(await recovered.authenticateDeviceToken(token), null);
  assert.deepEqual(await recovered.getSessionBinding('fixture-session'), await store.getSessionBinding('fixture-session'));
  assert.equal((await recovered.listReceipts({ sessionId: 'fixture-session' })).length, 1);
  const git = args => execFileSync('git', ['--git-dir', join(restored, 'codex.git'), ...args], { encoding: 'utf8', timeout: 30000 }).trim();
  assert.equal(git(['rev-parse', 'main']), market.commit);
  git(['fsck', '--full']);
  assert.equal(JSON.parse(git(['show', 'main:skillhub-releases.json'])).snapshotDigest, market.snapshotDigest);
  const report = { date: new Date().toISOString(), backend: 'isolated-json-and-bare-git', releaseId: release.id, releaseDigest: release.digest, gitCommit: market.commit, snapshotDigest: market.snapshotDigest, checks: ['source removed before restore', 'immutable release identical', 'Ed25519 signatures trusted', 'channel restored', 'device token remains revoked', 'fixed session and receipt restored', 'bare Git fsck and commit match'], limitation: 'Synthetic local quiescent snapshot; PostgreSQL pg_dump/pg_restore is verified separately by test:db. No production restore executed.' };
  if (process.env.RESTORE_REPORT) await writeFile(resolve(process.env.RESTORE_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
