/** Opt-in real-model regression for immutable old/new session workspaces. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubStore } from '../packages/core/index.mjs';
import { prepareSessionWorkspace, verifySessionWorkspace } from '../packages/adapters/session-workspace.mjs';
const args=process.argv.slice(2);
if(args.length!==5||args[0]!=='--run-model'||args[1]!=='--client'||!['codex','zcode'].includes(args[2])||args[3]!=='--output')throw new Error('Uses current logged-in model account. --run-model --client codex|zcode --output <directory>');
const client=args[2], output=resolve(args[4]);await mkdir(output,{recursive:true});
const root=await mkdtemp(join(tmpdir(),`skillhub-pinned-${client}-`));const store=await new HubStore({dataDir:join(root,'data')}).init();
const snapshots={};
for(const [phase,version]of[['old','1.0.0'],['new','1.1.0']]){
 const marker=phase==='old'?'v1':'v2';
 await store.saveContent({id:'session-rule',kind:'rule',title:'Pinned session rule',body:`For this bounded acceptance: hub_probe_release = ${marker}. Report this exact marker when asked.`});
 await store.saveContent({id:'hub-acceptance-probe',kind:'skill',title:'Read pinned reference marker',body:'Read references/probe.md and report its exact marker.',resources:[{path:'references/probe.md',body:`hub_probe_reference = ${marker}\n`}]});
 await store.saveBundle({id:'pinned-probe',name:'Pinned session acceptance',items:['session-rule','hub-acceptance-probe']});
 const release=await store.buildRelease('pinned-probe',version);
 snapshots[phase]=await prepareSessionWorkspace({release,client,root,sessionKey:phase});
}
const report={client,root,status:'running',createdAt:new Date().toISOString(),loadingRoute:'immutable-session-workspace-and-release-specific-plugin-id',cases:[]};
for(const [phase,snapshot,resume,expected]of[['old-initial',snapshots.old,null,'v1'],['new-initial',snapshots.new,null,'v2'],['old-resumed',snapshots.old,'old','v1']]){
 const prompt=`This is a bounded acceptance. Without opening AGENTS.md, report hub_probe_release from your current startup instructions. Use the hub-acceptance-probe skill${client==='zcode'?` from plugin ${snapshot.pluginName}`:''}, read its references/probe.md now (do not reuse prior reference text), and report the exact marker. Return only JSON with rule_marker and reference_marker. Do not modify any files.`;
 const promptFile=join(root,`${phase}-prompt.txt`);await writeFile(promptFile,prompt);
 const nativeSession=resume?report.cases[0].sessionId:null;
 const command=[fileURLToPath(new URL('./client-session-workspace.mjs', import.meta.url)),'launch','--run-model','--workspace',snapshot.workspace,'--prompt-file',promptFile,...(nativeSession?['--resume',nativeSession]:[])];
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,command,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),150000);
  child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.once('error',reject);child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
 await writeFile(join(output,`${phase}.jsonl`),result.stdout,{mode:0o600});
 if(result.code!==0){report.status='failed';report.error=`${phase} exit ${result.code}: ${result.stderr}`;break;}
 let response,sessionId;
 if(client==='codex'){
  const events=result.stdout.trim().split('\n').map(line=>JSON.parse(line));sessionId=events.find(e=>e.type==='thread.started')?.thread_id;
  response=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').at(-1)?.item.text;
 }else{const data=JSON.parse(result.stdout);response=data.response;sessionId=data.sessionId;}
 const answer=JSON.parse(response.match(/\{[\s\S]*?\}/)?.[0]??'null');
 assert.ok([expected,`hub_probe_release = ${expected}`].includes(answer.rule_marker), 'Rule marker must match the bound Release');
 assert.ok([expected,`hub_probe_reference = ${expected}`].includes(answer.reference_marker), 'Reference marker must match the bound Release');
 if(nativeSession)assert.equal(sessionId,nativeSession);
 await verifySessionWorkspace(snapshot.workspace);
 report.cases.push({phase,releaseId:snapshot.releaseId,pluginName:snapshot.pluginName,workspace:snapshot.workspace,sessionId,answer,status:'passed'});
 await writeFile(join(output,'pinned-sessions.json'),JSON.stringify(report,null,2));
}
if(report.cases.length===3)report.status='old-session-fixed-after-new-release-passed';
await writeFile(join(output,'pinned-sessions.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.status==='failed')process.exitCode=1;
