import { mkdir, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../core/index.mjs';
const idPattern=/^[a-zA-Z0-9][a-zA-Z0-9@._-]{0,127}$/;
async function directory(root){if(!isAbsolute(root??''))throw new Error('Explicit absolute receipt queue root required');await mkdir(root,{recursive:true,mode:0o700});const info=await lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe receipt queue root');}
function payload(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Receipt object required');
 for(const key of ['id','deviceId','releaseId'])if(!idPattern.test(value[key]??'')||value[key].includes('..'))throw new Error(`Invalid receipt ${key}`);
 if(!['fetched','installed','injection_claim','injected','behavior'].includes(value.kind))throw new Error('Invalid receipt kind');
 if(value.trusted===true||value.verification==='verified')throw new Error('Local queue cannot assert trusted injection');
 const allowed=new Set(['id','deviceId','sessionId','releaseId','kind','digest','evidence','source']);for(const key of Object.keys(value))if(!allowed.has(key))throw new Error(`Unknown receipt field ${key}`);
 const text=canonicalJson(value);if(Buffer.byteLength(text)>65536)throw new Error('Receipt exceeds 64 KiB');return text;
}
export async function enqueueReceipt(root,receipt){await directory(root);const text=payload(receipt);const path=join(root,`${createHash('sha256').update(receipt.id).digest('hex')}.json`);
 try{await writeFile(path,text,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||await readFile(path,'utf8')!==text)throw new Error('Queued receipt ID conflicts with existing payload');}
 return{id:receipt.id,status:'queued',trusted:false};
}
export async function flushReceipts(root,{server,token,fetcher=fetch}={}){
 await directory(root);const base=new URL(server);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('Invalid receipt server');
 const lock=join(root,'.flush-lock');await mkdir(lock);const report={sent:[],pending:[],errors:[]};
 try{for(const file of (await readdir(root)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort()){
  const path=join(root,file);try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe queued receipt');const receipt=JSON.parse(await readFile(path,'utf8'));const body=payload(receipt);
   const response=await fetcher(new URL('/api/receipts',base),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error(`Receipt endpoint returned ${response.status}`);const accepted=await response.json();if(accepted.id!==receipt.id)throw new Error('Receipt acknowledgement ID mismatch');
   await rm(path);report.sent.push(receipt.id);
  }catch(error){report.pending.push(file);report.errors.push({file,error:error.message.includes('Receipt endpoint')?error.message:'Receipt not acknowledged; retained for retry'});}
 }}finally{await rm(lock,{recursive:true});}return report;
}
