import {createClient} from 'genlayer-js';import {studionet} from 'genlayer-js/chains';
const c=createClient({chain:studionet});const r=await c.waitForTransactionReceipt({hash:process.argv[2],status:'FINALIZED',retries:4,interval:3000});console.log(JSON.stringify(r,(_,v)=>typeof v==='bigint'?v.toString():v,2));
