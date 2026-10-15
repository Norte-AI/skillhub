import { readFile } from 'node:fs/promises';
import { enqueueReceipt, flushReceipts } from '../packages/adapters/receipt-queue.mjs';
const [action,...args]=process.argv.slice(2),options={};
try{
 for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['queue','receipt','server'].includes(key)||Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid receipt option');options[key]=args[i+1];}
 const result=action==='enqueue'?await enqueueReceipt(options.queue,JSON.parse(await readFile(options.receipt,'utf8'))):action==='flush'?await flushReceipts(options.queue,{server:options.server,token:process.env.SKILLHUB_TOKEN}):null;
 if(!result)throw new Error('Usage: enqueue --queue <absolute-dir> --receipt <json> | flush --queue <absolute-dir> --server <url>');
 console.log(JSON.stringify(result,null,2));if(result.pending?.length)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
