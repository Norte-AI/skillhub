/** Explicit PostgreSQL migration. Source is read-only; never prints connection strings. */
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PostgresStore } from '../packages/storage/index.mjs';
import { canonicalJson } from '../packages/core/index.mjs';
const sha=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const failure=message=>Object.assign(new Error(message),{code:'UNIFIED_MIGRATION_ERROR'});
export function stateSummary(state){return {sha256:sha(state),counts:Object.fromEntries(Object.entries(state).filter(([key])=>key!=='schemaVersion').map(([key,value])=>[key,key==='content'?Object.values(value).reduce((n,revisions)=>n+revisions.length,0):key==='channels'?Object.values(value).reduce((n,channels)=>n+Object.keys(channels).length,0):Object.keys(value).length]))};}
export async function transferSnapshot({source,target,backupDir,verifyOnly=false,snapshotFile}){
 let state;
 if(snapshotFile){const info=await lstat(snapshotFile);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw failure('Snapshot must be a private regular file (0600)');state=JSON.parse(await readFile(snapshotFile,'utf8'));}
 else state=await source.readSnapshot(); // REPEATABLE READ READ ONLY; do not call source.init().
 const sourceSummary=stateSummary(state);
 let snapshotPath=snapshotFile;
 if(!verifyOnly){
  if(!isAbsolute(backupDir??''))throw failure('An explicit absolute --backup-dir is required');
  // Exclusive creation protects existing backups and refuses symlinks/directories.
  await mkdir(backupDir,{mode:0o700});snapshotPath=join(backupDir,'state.json');
  await writeFile(snapshotPath,`${canonicalJson(state)}\n`,{flag:'wx',mode:0o600});
  await writeFile(join(backupDir,'snapshot-report.json'),`${JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),...sourceSummary},null,2)}\n`,{flag:'wx',mode:0o600});
 }
 // init only the target schema. importLegacy validates complete state and holds an
 // advisory transaction lock while rejecting every non-empty destination.
 if(!verifyOnly)await target.init();
 let current=await target.readSnapshot();let status;
 if(sha(current)===sourceSummary.sha256)status='already-identical';
 else if(verifyOnly)throw failure('Target differs from the recorded source snapshot; no data changed');
 else{
  try{await target.importLegacy({state});status='imported';}
  catch(error){
   // Concurrent identical importer is idempotent; other existing data is never overwritten.
   if(sha(await target.readSnapshot())!==sourceSummary.sha256)throw failure('Target is non-empty, incompatible, or import failed; no existing state overwritten');
   status='already-identical';
  }
 }
 current=await target.readSnapshot();if(sha(current)!==sourceSummary.sha256)throw failure('Post-import state verification failed');
 const result={schemaVersion:1,status:verifyOnly?'verified':status,sourceSnapshotReadOnly:true,verified:true,...sourceSummary,snapshot:snapshotPath};
 if(!verifyOnly)await writeFile(join(backupDir,'migration-report.json'),`${JSON.stringify(result,null,2)}\n`,{flag:'wx',mode:0o600});
 return result;
}
export function parseMigration(args,env=process.env){
 const options={};for(let i=0;i<args.length;i++){
  if(args[i]==='--verify'&&!options.verifyOnly){options.verifyOnly=true;continue;}
  const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['backup-dir','snapshot','source-schema','target-schema'].includes(key)||Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw failure('Usage: [--verify --snapshot <0600-file>] [--backup-dir <new-absolute-dir>] [--source-schema skillhub] [--target-schema skillhub]; database URLs are environment-only');options[key]=args[++i];
 }
 if(!env.SKILLHUB_MIGRATION_TARGET_DATABASE_URL||(!options.snapshot&&!env.SKILLHUB_MIGRATION_SOURCE_DATABASE_URL))throw failure('Set explicit SKILLHUB_MIGRATION_SOURCE_DATABASE_URL and SKILLHUB_MIGRATION_TARGET_DATABASE_URL; verification may use --snapshot instead of source');
 if(options.snapshot&&!options.verifyOnly)throw failure('--snapshot is accepted only with --verify');
 if(options.verifyOnly&&options['backup-dir'])throw failure('--verify does not write a backup directory');
 if(!options.verifyOnly&&!isAbsolute(options['backup-dir']??''))throw failure('An explicit absolute --backup-dir is required');
 const sourceSchema=options['source-schema']??'skillhub',targetSchema=options['target-schema']??'skillhub';
 for(const schema of [sourceSchema,targetSchema])if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||schema==='public')throw failure('Migration schema must be a named runtime schema; registry public is forbidden');
 if(env.SKILLHUB_MIGRATION_SOURCE_DATABASE_URL===env.SKILLHUB_MIGRATION_TARGET_DATABASE_URL&&sourceSchema===targetSchema)throw failure('Source and target must be different database schemas');
 return{verifyOnly:options.verifyOnly??false,backupDir:options['backup-dir'],snapshotFile:options.snapshot?resolve(options.snapshot):undefined,sourceSchema,targetSchema};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let source,target;try{
  const options=parseMigration(process.argv.slice(2));
  if(!options.snapshotFile)source=new PostgresStore({connectionString:process.env.SKILLHUB_MIGRATION_SOURCE_DATABASE_URL,schema:options.sourceSchema});
  target=new PostgresStore({connectionString:process.env.SKILLHUB_MIGRATION_TARGET_DATABASE_URL,schema:options.targetSchema});
  console.log(JSON.stringify(await transferSnapshot({source,target,...options}),null,2));
 }catch(error){console.error(error.code==='UNIFIED_MIGRATION_ERROR'?error.message:'Unified migration failed; verify explicit database connectivity, schema and private backup path. Connection details are suppressed.');process.exitCode=1;}
 finally{await Promise.allSettled([source?.close(),target?.close()]);}
}
