/** Explicitly opt-in model checks. Uses the existing logged-in Codex without inspecting credentials. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HubStore } from '../packages/core/index.mjs';
import { exportMarketplace } from '../packages/exporter/index.mjs';

export async function codexSessionAcceptance({ output }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'skillhub-model-acceptance-')));
  const store = await new HubStore({ dataDir: join(root, 'data') }).init();
  const releases = {};
  for (const [marker, version] of [['v1', '1.0.0'], ['v2', '1.1.0']]) {
    await store.saveContent({ id: 'hub-session-rule', kind: 'rule', title: 'Session acceptance rule', body: `For this isolated acceptance only: hub_probe_release = ${marker}. Include this exact marker when asked.` });
    await store.saveContent({ id: 'hub-acceptance-probe', kind: 'skill', title: 'Read the acceptance reference marker', body: 'Read references/probe.md and report its exact marker.', resources: [{ path: 'references/probe.md', body: `hub_probe_reference = ${marker}\n` }] });
    await store.saveBundle({ id: 'session-probe', name: 'Isolated session probe', items: ['hub-session-rule', 'hub-acceptance-probe'] });
    releases[marker] = await store.buildRelease('session-probe', version);
    await exportMarketplace({ release: releases[marker], target: 'codex', outDir: join(root, marker) });
  }
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), root, client: 'codex', nativePluginActivation: 'not-tested-by-this-probe', loadingRoute: 'project-AGENTS.md-and-.agents/skills', cases: [], limits: ['Ephemeral fresh sessions only; old-session pinning is not established.', 'Model responses are observed behavior, not a trusted server injection receipt.'] };
  for (const [phase, marker] of [['install', 'v1'], ['update', 'v2'], ['rollback', 'v1']]) {
    await cp(join(root, marker, 'AGENTS.md'), join(workspace, 'AGENTS.md'));
    await cp(join(root, marker, 'plugins/session-probe/skills'), join(workspace, '.agents/skills'), { recursive: true, force: true });
    const args = ['-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', workspace, '--json', 'For this isolated client acceptance, identify hub_probe_release from your startup instructions without opening AGENTS.md. Then use $hub-acceptance-probe and report the reference marker. Return only JSON with rule_marker and reference_marker. Do not inspect anything outside this isolated workspace.'];
    const result = await new Promise((resolve, reject) => {
      const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
      child.stdout.on('data', value => { stdout += value; if (stdout.length > 2 * 1024 * 1024) child.kill('SIGTERM'); });
      child.stderr.on('data', value => { stderr += value; if (stderr.length > 2 * 1024 * 1024) child.kill('SIGTERM'); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, stdout }); });
    });
    await writeFile(join(root, `${phase}.jsonl`), result.stdout, { mode: 0o600 });
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const message = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1)?.item.text;
    const answer = JSON.parse(message);
    assert.equal(result.code, 0);
    assert.equal(answer.rule_marker, `hub_probe_release = ${marker}`);
    assert.equal(answer.reference_marker, `hub_probe_reference = ${marker}`);
    const commands = events.filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution');
    assert.ok(commands.some(event => event.item.command.includes('probe.md')), 'Reference must actually be fetched');
    assert.ok(!commands.some(event => event.item.command.includes('AGENTS.md')), 'Rule must come from startup, not an explicit file read');
    report.cases.push({ phase, releaseId: releases[marker].id, sessionId: events.find(event => event.type === 'thread.started')?.thread_id, result: 'passed', answer, events: `${phase}.jsonl`, usage: events.find(event => event.type === 'turn.completed')?.usage });
    if (output) { await mkdir(resolve(output), { recursive: true }); await cp(join(root, `${phase}.jsonl`), join(resolve(output), `${phase}.jsonl`)); }
  }
  report.status = 'fresh-session-install-update-rollback-passed';
  await writeFile(join(root, 'model-sessions.json'), JSON.stringify(report, null, 2));
  if (output) await writeFile(join(resolve(output), 'model-sessions.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] !== '--run-model' || args.length !== 3 || args[1] !== '--output') throw new Error('This invokes the current logged-in account. Usage: --run-model --output <evidence-directory>');
  try { console.log(JSON.stringify(await codexSessionAcceptance({ output: args[2] }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
