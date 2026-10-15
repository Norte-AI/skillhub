// Isolated benchmark. Never reads the deployment database or service directories.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { HubStore } from '../packages/core/index.mjs';
import { enqueueBuild, createBuildWorker, listBuilds } from '../packages/build/index.mjs';
import { generateSigningKeyPair, verifyReleaseSignatures } from '../packages/signing/index.mjs';
const count = Number(process.env.BENCH_JOBS ?? 100);
const concurrency = Number(process.env.BENCH_WORKERS ?? 4);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('BENCH_JOBS 1..1000 and BENCH_WORKERS 1..16 required');
const directory = await mkdtemp(join(tmpdir(), 'skillhub-benchmark-'));
const workers = [];
try {
  const key = generateSigningKeyPair();
  const store = await new HubStore({ dataDir: directory, signingKey: key }).init();
  await store.saveContent({ id: 'rule', kind: 'rule', title: 'Benchmark', body: 'Preserve user files. '.repeat(100) });
  await store.saveBundle({ id: 'bench', name: 'Benchmark', items: ['rule'], targets: ['codex', 'kimi', 'zcode'] });
  const queued = performance.now();
  for (let i = 0; i < count; i++) await enqueueBuild(store, { bundleId: 'bench', version: `1.0.${i}` });
  const started = performance.now();
  for (let i = 0; i < concurrency; i++) workers.push(createBuildWorker(store));
  await Promise.all(workers.map(worker => worker.kick()));
  await Promise.all(workers.map(worker => worker.close()));
  const ended = performance.now();
  const jobs = await listBuilds(store);
  assert.equal(jobs.length, count);
  assert.ok(jobs.every(job => job.status === 'ready'), JSON.stringify(jobs.filter(job => job.status !== 'ready')));
  const releases = await store.listReleases();
  assert.equal(releases.length, count);
  for (const release of releases) assert.equal(verifyReleaseSignatures(await store.getRelease(release.id), { [key.keyId]: key.publicKey }), true);
  const latencies = jobs.map(job => Date.parse(job.completedAt) - Date.parse(job.startedAt)).sort((a, b) => a - b);
  const report = { date: new Date().toISOString(), backend: 'isolated-single-process-json', node: process.version, jobs: count, workers: concurrency, targetsPerJob: 3, queueMs: Math.round(started - queued), buildMs: Math.round(ended - started), jobsPerSecond: Number((count * 1000 / (ended - started)).toFixed(2)), p50ServiceMs: latencies[Math.floor(count * .5)], p95ServiceMs: latencies[Math.min(count - 1, Math.floor(count * .95))], ready: jobs.length, signedArtifactsVerified: count * 3, assertion: 'no lost jobs, duplicate releases, failed jobs or invalid signatures', limitation: 'Local bounded baseline; not a production capacity claim or multi-process JSON support.' };
  if (process.env.BENCH_REPORT) await writeFile(resolve(process.env.BENCH_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await Promise.all(workers.map(worker => worker.close())); await rm(directory, { recursive: true, force: true }); }
