import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,rm,readdir}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{enqueueReceipt,flushReceipts}from'../packages/adapters/receipt-queue.mjs';
test('offline receipt queue deduplicates, preserves failures, acknowledges only matching IDs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'receipt-queue-'));t.after(()=>rm(root,{recursive:true,force:true}));const receipt={id:'receipt-1',deviceId:'probe',releaseId:'demo@1.0.0',kind:'injection_claim',evidence:'Model reports marker; unverified'};
 await enqueueReceipt(root,receipt);await enqueueReceipt(root,receipt);assert.equal((await readdir(root)).length,1);
 await assert.rejects(enqueueReceipt(root,{...receipt,evidence:'different'}),/conflicts/);
 let result=await flushReceipts(root,{server:'http://127.0.0.1',fetcher:async()=>{throw new Error('network unavailable');}});assert.equal(result.pending.length,1);assert.equal((await readdir(root)).length,1);
 result=await flushReceipts(root,{server:'http://127.0.0.1',fetcher:async()=>({ok:true,json:async()=>({id:'wrong'})})});assert.equal(result.sent.length,0);
 result=await flushReceipts(root,{server:'http://127.0.0.1',fetcher:async(url,init)=>{assert.equal(JSON.parse(init.body).kind,'injection_claim');return{ok:true,json:async()=>({id:receipt.id,trusted:false})};}});assert.deepEqual(result.sent,[receipt.id]);assert.deepEqual(await readdir(root),[]);
 await assert.rejects(enqueueReceipt(root,{...receipt,trusted:true}),/trusted/);
});

test('queued claims replay through actual authenticated HTTP once and stay unverified',async t=>{
 const {createServer}=await import('../apps/server/src/index.mjs');const root=await mkdtemp(join(tmpdir(),'receipt-http-'));
 const app=await createServer({dataDir:join(root,'data'),token:'test-admin',logger:()=>{}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const server=`http://127.0.0.1:${app.server.address().port}`;const post=async(path,body)=>{const response=await fetch(server+path,{method:'POST',headers:{Authorization:'Bearer test-admin','Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};
 await post('/api/content',{id:'r',kind:'rule',title:'Rule',body:'marker-v1'});await post('/api/bundles',{id:'b',name:'Bundle',items:['r']});const release=await post('/api/releases',{bundleId:'b',version:'1.0.0'});
 await post('/api/devices',{id:'d',name:'Probe',client:'codex',assignments:['b']});const issued=await post('/api/devices/d/token');
 const receipt={id:'claim',deviceId:'d',releaseId:release.id,kind:'injection_claim',evidence:'Observed model marker-v1; not trusted injection'};const queue=join(root,'queue');await enqueueReceipt(queue,receipt);
 assert.deepEqual((await flushReceipts(queue,{server,token:issued.token})).sent,['claim']);await enqueueReceipt(queue,receipt);assert.deepEqual((await flushReceipts(queue,{server,token:issued.token})).sent,['claim']);
 const response=await fetch(server+'/api/receipts',{headers:{Authorization:'Bearer test-admin'}});const saved=await response.json();assert.equal(saved.length,1);assert.equal(saved[0].trusted,false);assert.equal(saved[0].verification,'unverified');
});
