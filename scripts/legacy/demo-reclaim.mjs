import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim();
const author = createAccount(authorKey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });

const RULES = "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. No hate speech or harassment. No violence or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const HOST = "https://artem1981777.github.io";
const DIR = "/genlayer-content-moderator/fixtures/";
const U_BENIGN = HOST + DIR + "benign.html";
const MIN_STAKE = 1000000000000n;
const APPEAL_BOND = 2000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";

// captured from the prior demo run (Item A, permissionless enforce)
const DEMO_DEPLOY_TX = "0x5f41b18eb5baca97f848b2697ebc81b0c72fe9fe966896051abd4279dcc5dd4e";
const ENFORCE_TX = "0xf12ed266f0777bb0a0d4e09b783e55d0bfda7c61403af2f37d3281d18c94cab0";
const ENFORCE_ITEM = "bde0759e8c2ab8a1";

let ADDRESS = readFileSync("registry-demo-contract.txt","utf8").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isNet(msg){ msg=String(msg||"").toLowerCase(); return msg.includes("not_voted")||msg.includes("finished_with_error")||msg.includes("timeout")||msg.includes("timed out")||msg.includes("fetch failed")||msg.includes("-32005")||msg.includes("capacity")||msg.includes("rate limit")||msg.includes("exceeds defined limit")||msg.includes("consensus contract")||msg.includes("evm tx"); }
async function waitFinal(client, hash, label, maxIters){
  for(let i=0;i<(maxIters||90);i++){
    let tx=null;
    try{ tx=await client.getTransaction({hash}); }catch(e){ await sleep(5000); continue; }
    const rn=String(tx?.txExecutionResultName||"");
    if(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN") return tx;
    if(/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("exec failed "+label+": "+rn);
    if(i%5===0) console.log("  waiting finality "+label+" ("+(rn||"pending")+")");
    await sleep(6000);
  }
  throw new Error("timeout finality "+label);
}
async function w(client, fn, args, value){
  for(let attempt=1;attempt<=12;attempt++){
    try{
      const hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n});
      await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400});
      await waitFinal(client,hash,fn,90);
      console.log("  "+fn+" tx:",hash);
      return hash;
    }catch(e){
      const msg=e?.message||String(e);
      console.log("  "+fn+" attempt "+attempt+": "+String(msg).slice(0,110));
      if(isNet(msg)&&attempt<12){ await sleep(15000); continue; }
      throw e;
    }
  }
}
async function readJson(client, fn, args){
  const raw=await client.readContract({address:ADDRESS,functionName:fn,args:args||[]});
  if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } }
  return raw;
}
async function newestId(){ const ids=await readJson(cOp,"get_item_ids",[]); return Array.isArray(ids)?ids[ids.length-1]:null; }
async function mkItem(){ await w(cOp,"create_item",[RULES],0n); const id=await newestId(); console.log("  item_id:",id); return id; }
async function ensureGas(minWei, topupWei){
  const b=await cOp.getBalance({address:author.address});
  console.log("author balance:",b.toString());
  if(b<minWei){
    let h;
    try{ h=await cOp.sendTransaction({to:author.address,value:topupWei}); }
    catch(e){ h=await cOp.sendTransaction({account:operator,to:author.address,value:topupWei}); }
    console.log("topup tx:",h);
    for(let i=0;i<25;i++){ const nb=await cOp.getBalance({address:author.address}); if(nb>=minWei){ console.log("author funded:",nb.toString()); break; } await sleep(6000); }
  }
}

async function main(){
  console.log("=== RECLAIM top-up on demo instance:",ADDRESS,"===");
  await ensureGas(6000000000000000n,20000000000000000n);
  try{ await w(cOp,"release_url",[U_BENIGN],0n); }catch(e){ console.log("  release_url:",String(e?.message||e).slice(0,60)); }

  const idB=await mkItem();
  await w(cAuthor,"ingest",[idB,U_BENIGN],MIN_STAKE); // benign -> reliable APPROVE (converges)
  await w(cOp,"moderate",[idB],0n);
  await w(cOp,"enforce",[idB],0n); // owner enforce -> enforced
  await w(cAuthor,"appeal",[idB,"Author reclaim-path demo: awaiting owner resolution."],APPEAL_BOND);
  let xb=await readJson(cOp,"get_item",[idB]);
  console.log("  B status after appeal:",xb.status,"| appeal_ts:",xb.appeal_ts);
  console.log("  sleeping 95s to pass APPEAL_TIMEOUT (60s)...");
  await sleep(95000);
  const reclaimTx=await w(cAuthor,"reclaim_appeal",[idB],0n);
  xb=await readJson(cOp,"get_item",[idB]);
  console.log("  B status:",xb.status,"| appeal_outcome:",xb.appeal_outcome);

  const evidence={
    demo_instance:ADDRESS,
    note:"Dedicated DEMO instance with ENFORCE_TIMEOUT_SEC=60 and APPEAL_TIMEOUT_SEC=60. Production v1.2 (0x62A9196dBB55585840D13631aB7C68288761a74A) keeps 86400/172800. This instance exists ONLY to produce live positive-path timeout proofs.",
    demo_deploy_tx:DEMO_DEPLOY_TX,
    permissionless_enforce_tx:ENFORCE_TX,
    permissionless_enforce_item:ENFORCE_ITEM,
    reclaim_appeal_tx:String(reclaimTx),
    reclaim_appeal_item:idB,
    reclaim_appeal_outcome:xb.appeal_outcome,
    reclaim_final_status:xb.status,
    explorer:{
      address:EX+"/address/"+ADDRESS,
      deploy:EX+"/tx/"+DEMO_DEPLOY_TX,
      permissionless_enforce:EX+"/tx/"+ENFORCE_TX,
      reclaim_appeal:EX+"/tx/"+reclaimTx
    }
  };
  writeFileSync("registry-demo-evidence.json",JSON.stringify(evidence,null,2));
  console.log("=== DEMO EVIDENCE (saved) ===");
  console.log(JSON.stringify(evidence,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
