/** Release-pinned client sessions. Existing session directories are never updated. */
import { readFile, mkdir, cp, writeFile, lstat, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join, isAbsolute } from 'node:path';
import { createStore } from '../packages/storage/index.mjs';
import { prepareSessionWorkspace, verifySessionWorkspace } from '../packages/adapters/session-workspace.mjs';

const [action, ...args] = process.argv.slice(2); const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i]?.slice(2);
  if (key === 'run-model' && !Object.hasOwn(options, key)) { options[key] = true; continue; }
  if (!args[i]?.startsWith('--') || !['root','session-key','client','release','data','workspace','prompt-file','resume'].includes(key) || Object.hasOwn(options,key) || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Invalid session-workspace option');
  options[key] = args[++i];
}
async function execute(command,args,cwd) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
    child.stdout.on('data',v=>{stdout+=v;if(stdout.length>2*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',v=>{stderr+=v;if(stderr.length>2*1024*1024)child.kill('SIGTERM');});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(`Client process failed (${code}); no binding changed`));else resolve(stdout);});
  });
}
try {
  if(action==='prepare') {
    if(!options.release || !options.client || !options['session-key'] || !isAbsolute(options.root??''))throw new Error('prepare requires --release <fixed-id> --client --session-key --root <absolute-directory> [--data]');
    const store=createStore({databaseUrl:process.env.SKILLHUB_DATABASE_URL,dataDir:resolve(options.data??process.env.SKILLHUB_DATA_DIR??'.skillhub-data')});
    try{await store.init();console.log(JSON.stringify(await prepareSessionWorkspace({release:await store.getRelease(options.release),client:options.client,sessionKey:options['session-key'],root:options.root}),null,2));}finally{await store.close();}
  }else if(action==='doctor')console.log(JSON.stringify(await verifySessionWorkspace(options.workspace),null,2));
  else if(action==='launch') {
    if(!options['run-model'] || !isAbsolute(options.workspace??'') || !isAbsolute(options['prompt-file']??''))throw new Error('launch uses the existing logged-in model account; requires --run-model --workspace <absolute-snapshot> --prompt-file <absolute-file> [--resume <native-session-id>]');
    const lock=await verifySessionWorkspace(options.workspace);
    const runtime=join(lock.workspace,'.skillhub-runtime'); await mkdir(runtime,{recursive:true});
    if((await lstat(runtime)).isSymbolicLink())throw new Error('Unsafe native session runtime');
    const bindingFile=join(runtime,'native-session.json'); let binding;
    try { const entry=await lstat(bindingFile);if(!entry.isFile()||entry.isSymbolicLink())throw new Error('Unsafe native session binding');binding=JSON.parse(await readFile(bindingFile,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(options.resume && (!binding || binding.sessionId!==options.resume || binding.releaseId!==lock.releaseId || binding.releaseDigest!==lock.releaseDigest || binding.client!==lock.client))throw new Error('Native resume ID does not match the locked session and Release');
    if(!options.resume && binding)throw new Error('Workspace already has a native session; use its --resume ID or prepare a new sessionKey');
    const prompt=await readFile(options['prompt-file'],'utf8');
    if(!prompt.trim()||Buffer.byteLength(prompt)>16384)throw new Error('Prompt must be 1–16384 bytes');
    if(options.resume && !/^(?:sess_)?[a-zA-Z0-9-]{8,80}$/.test(options.resume))throw new Error('Invalid native session ID');
    const operationLock=join(runtime,'.launch-lock');await mkdir(operationLock);
    let nativeOutput;
    try {
    if(lock.client==='codex') {
      const args=['-a','never','exec','--ignore-user-config','--sandbox','read-only','--skip-git-repo-check','--cd',lock.workspace,'--json'];
      if(options.resume)args.push('resume',options.resume);
      args.push(prompt);nativeOutput=await execute('codex',args,lock.workspace);
    }else if(lock.client==='zcode') {
      // The bundled JS entry searches for provider/zcode-builtin.json adjacent to itself.
      // Copy only application code and public bundled provider metadata, never user credentials.
      await mkdir(join(runtime,'provider'),{recursive:true});
      await cp('/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',join(runtime,'zcode.cjs'));
      await cp('/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json',join(runtime,'provider/zcode-builtin.json'));
      const binary=join(runtime,'zcode.cjs');
      await execute(process.execPath,[binary,'plugins','marketplace','add',lock.workspace,'--scope','project','--cwd',lock.workspace],lock.workspace);
      await execute(process.execPath,[binary,'plugins','install',`${lock.pluginName}@skill-hub-${lock.pluginName}`,'--scope','project','--cwd',lock.workspace],lock.workspace);
      const args=[binary,'--cwd',lock.workspace,'--mode','plan','--json',...(options.resume?['--resume',options.resume]:[]),'--prompt',prompt];
      nativeOutput=await execute(process.execPath,args,lock.workspace);
    }else throw new Error('Kimi Desktop requires selecting this Release-specific plugin in a dedicated Work session; this script never silently starts another product');
    const sessionId=lock.client==='codex'?nativeOutput.trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='thread.started')?.thread_id:JSON.parse(nativeOutput).sessionId;
    if(!sessionId || (options.resume && sessionId!==binding.sessionId))throw new Error('Client did not return the expected native session ID');
    if(!binding)await writeFile(bindingFile,JSON.stringify({schemaVersion:1,client:lock.client,sessionId,releaseId:lock.releaseId,releaseDigest:lock.releaseDigest},null,2),{flag:'wx',mode:0o600});
    console.log(nativeOutput);
    }finally{await rmdir(operationLock);}
  }else throw new Error('Usage: client-session-workspace.mjs prepare|doctor|launch');
}catch(error){console.error(error.message);process.exitCode=1;}
