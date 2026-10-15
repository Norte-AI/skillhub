import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm,readFile,stat,chmod}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{randomUUID}from'node:crypto';import{Pool}from'pg';
import{PostgresStore}from'../packages/storage/index.mjs';import{transferSnapshot,parseMigration,stateSummary}from'../scripts/migrate-unified.mjs';
test('migration rejects ambiguous env, registry public and command-line secrets',()=>{
 assert.throws(()=>parseMigration([],{}),/explicit/);const env={SKILLHUB_MIGRATION_SOURCE_DATABASE_URL:'postgres://source',SKILLHUB_MIGRATION_TARGET_DATABASE_URL:'postgres://target'};
 assert.throws(()=>parseMigration(['--source-url','postgres://secret'],env),/environment-only/);assert.throws(()=>parseMigration(['--target-schema','public','--backup-dir','/tmp/new'],env),/public/);assert.equal(parseMigration(['--backup-dir','/tmp/new'],env).targetSchema,'skillhub');
});
test('migration writes private snapshot and refuses different existing data without mutation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'migration-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));const state={schemaVersion:1,content:{},bundles:{},releases:{},channels:{},listings:{},devices:{},sessions:{},receipts:{},audit:[],submissions:{},builds:{}};let imported=0;let current=structuredClone(state);
 const source={readSnapshot:async()=>structuredClone(state)};const target={init:async()=>{},readSnapshot:async()=>structuredClone(current),importLegacy:async({state})=>{imported++;current=structuredClone(state);}};
 const result=await transferSnapshot({source,target,backupDir:join(root,'backup')});assert.equal(result.status,'already-identical');assert.equal(imported,0);assert.equal((await stat(join(root,'backup/state.json'))).mode&0o777,0o600);
 assert.equal((await transferSnapshot({target,verifyOnly:true,snapshotFile:join(root,'backup/state.json')})).status,'verified');
 current.bundles.other={id:'other'};await assert.rejects(transferSnapshot({target,verifyOnly:true,snapshotFile:join(root,'backup/state.json')}),/differs/);assert.ok(current.bundles.other);
 await chmod(join(root,'backup/state.json'),0o644);await assert.rejects(transferSnapshot({target,verifyOnly:true,snapshotFile:join(root,'backup/state.json')}),/0600/);
});
const connectionString=process.env.SKILLHUB_TEST_DATABASE_URL;
test('isolated real PostgreSQL imports complete snapshot, reruns identically, refuses conflicts, leaves source unchanged',{skip:!connectionString&&'SKILLHUB_TEST_DATABASE_URL unset'},async t=>{
 const suffix=randomUUID().replaceAll('-','');const schemas=['migration_source_'+suffix,'migration_target_'+suffix];const pool=new Pool({connectionString});const [source,target]=schemas.map(schema=>new PostgresStore({pool,schema}));const root=await mkdtemp(join(tmpdir(),'migration-pg-'));
 t.after(async()=>{for(const schema of schemas)await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();await rm(root,{recursive:true,force:true});});
 await source.init();await source.saveContent({id:'r',kind:'rule',title:'Rule',body:'original'});await source.saveBundle({id:'b',name:'Bundle',items:['r']});const release=await source.buildRelease('b','1.0.0');await source.setChannel('b','stable',release.id);await source.registerDevice({id:'d',name:'Device',client:'codex',assignments:['b']});await source.issueDeviceToken('d');await source.bindSession({id:'s',deviceId:'d',releaseIds:[release.id]});await source.reportReceipt({id:'receipt',deviceId:'d',sessionId:'s',releaseId:release.id,kind:'behavior',evidence:'fixture'});
 const before=await source.readSnapshot();const result=await transferSnapshot({source,target,backupDir:join(root,'first')});assert.equal(result.status,'imported');assert.deepEqual(await target.readSnapshot(),before);assert.deepEqual(await source.readSnapshot(),before);
 assert.equal((await transferSnapshot({source,target,backupDir:join(root,'second')})).status,'already-identical');
 await target.saveContent({id:'extra',kind:'rule',title:'Target extra',body:'preserve'});const changed=await target.readSnapshot();await assert.rejects(transferSnapshot({source,target,backupDir:join(root,'conflict')}),/non-empty/);assert.deepEqual(await target.readSnapshot(),changed);assert.deepEqual(await source.readSnapshot(),before);
});
