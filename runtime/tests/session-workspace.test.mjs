import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HubStore } from '../packages/core/index.mjs';
import { prepareSessionWorkspace, verifySessionWorkspace } from '../packages/adapters/session-workspace.mjs';
async function fixture(t) {
 const root = await mkdtemp(join(tmpdir(), 'session-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
 const store = await new HubStore({ dataDir: join(root, 'data') }).init();
 await store.saveContent({ id: 'probe', kind: 'skill', title: 'Probe', body: 'v1', resources: [{ path: 'references/probe.md', body: 'ref-v1' }] });
 await store.saveBundle({ id: 'demo', name: 'Demo', items: ['probe'] });
 const first = await store.buildRelease('demo', '1.0.0');
 await store.saveContent({ id: 'probe', kind: 'skill', title: 'Probe', body: 'v2', resources: [{ path: 'references/probe.md', body: 'ref-v2' }] });
 const second = await store.buildRelease('demo', '1.1.0'); return { root, first, second };
}
test('separate client session snapshots retain fixed resources when a new Release is prepared', async t => {
 const {root, first, second} = await fixture(t);
 for (const client of ['codex','zcode','kimi']) {
  const old = await prepareSessionWorkspace({release:first,client,sessionKey:`${client}-old`,root});
  const next = await prepareSessionWorkspace({release:second,client,sessionKey:`${client}-new`,root});
  assert.notEqual(old.pluginName,next.pluginName);
  assert.equal(await readFile(join(old.workspace,'plugins',old.pluginName,'skills/probe/references/probe.md'),'utf8'),'ref-v1');
  assert.equal(await readFile(join(next.workspace,'plugins',next.pluginName,'skills/probe/references/probe.md'),'utf8'),'ref-v2');
  assert.equal((await verifySessionWorkspace(old.workspace)).releaseId,first.id);
  await assert.rejects(prepareSessionWorkspace({release:second,client,sessionKey:`${client}-old`,root}),/already bound/);
  assert.equal((await prepareSessionWorkspace({release:first,client,sessionKey:`${client}-old`,root})).status,'verified-snapshot');
 }
});
test('doctor detects managed snapshot drift and rejects symlink substitution',async t=>{
 const {root,first}=await fixture(t);const s=await prepareSessionWorkspace({release:first,client:'codex',sessionKey:'probe',root});
 await writeFile(join(s.workspace,'AGENTS.md'),'changed');await assert.rejects(verifySessionWorkspace(s.workspace),/drift/);
 const other=await prepareSessionWorkspace({release:first,client:'zcode',sessionKey:'other',root});
 await rm(join(other.workspace,'AGENTS.md'));await symlink(join(s.workspace,'AGENTS.md'),join(other.workspace,'AGENTS.md'));
 await assert.rejects(verifySessionWorkspace(other.workspace),/symlinked/);
});

test('session doctor rejects untracked injected skills rather than treating them as user data',async t=>{
 const {root,first}=await fixture(t);const s=await prepareSessionWorkspace({release:first,client:'codex',sessionKey:'extra',root});
 await writeFile(join(s.workspace,'.agents/skills/probe/injected.md'),'untrusted extra');
 await assert.rejects(verifySessionWorkspace(s.workspace),/Unexpected managed session file/);
});

test('launch rejects an unbound native resume before it can call any model',async t=>{
 const {root,first}=await fixture(t);const s=await prepareSessionWorkspace({release:first,client:'codex',sessionKey:'no-model',root});
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/client-session-workspace.mjs', import.meta.url)),'launch','--run-model','--workspace',s.workspace,'--prompt-file',join(root,'missing-prompt'),'--resume','01a13e93-d28b-7e13-9819-8fede6c79a49'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.match(result.stderr,/does not match the locked session/);
});
