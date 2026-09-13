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
const U_MILD = HOST + DIR + "mild.html";
const MIN_STAKE = 1000000000000n;
const APPEAL_BOND = 2000000000000n;
const POOL_FUND = 5000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";

let ADDRESS = "";
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
  for(let attempt=1;attempt<=10;attempt++){
    try{
      const hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n});
      await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400});
      await waitFinal(client,hash,fn,90);
      console.log("  "+fn+" tx:",hash);
      return hash;
    }catch(e){
      const msg=e?.message||String(e);
      console.log("  "+fn+" attempt "+attempt+": "+String(msg).slice(0,110));
      if(isNet(msg)&&attempt<10){ await sleep(15000); continue; }
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
  console.log("=== DEMO EVIDENCE INSTANCE (ENFORCE/APPEAL timeout = 60s) ===");
  console.log("owner:",operator.address," author:",author.address);
  if(operator.address.toLowerCase()===author.address.toLowerCase()) throw new Error("operator and author must differ");

  console.log("=== 0) DEPLOY demo contract ===");
  const source=readFileSync("contracts/registry_demo.py","utf8");
  const code=new TextEncoder().encode(source);
  const dHash=await cOp.deployContract({code,args:[RULES]});
  console.log("demo deploy tx:",dHash);
  await cOp.waitForTransactionReceipt({hash:dHash,status:TransactionStatus.ACCEPTED,retries:300});
  const dtx=await cOp.getTransaction({hash:dHash});
  ADDRESS=dtx?.txDataDecoded?.contractAddress ?? dtx?.recipient;
  console.log("demo address:",ADDRESS,"| exec:",dtx?.txExecutionResultName);
  writeFileSync("registry-demo-contract.txt",String(ADDRESS));
  writeFileSync("registry-demo-tx.txt",String(dHash));

  await ensureGas(10000000000000000n,30000000000000000n);
  try{ await w(cOp,"fund_pool",[],POOL_FUND); }catch(e){ console.log("fund_pool skipped:",String(e?.message||e).slice(0,60)); }

  console.log("=== A) PERMISSIONLESS ENFORCE after timeout ===");
  const idA=await mkItem();
  await w(cAuthor,"ingest",[idA,U_BENIGN],MIN_STAKE);
  await w(cOp,"moderate",[idA],0n);
  let xa=await readJson(cOp,"get_item",[idA]);
  console.log("  A verdict:",xa.verdict,"| status:",xa.status,"| verdict_ts:",xa.verdict_ts);
  console.log("  sleeping 95s to pass ENFORCE_TIMEOUT (60s)...");
  await sleep(95000);
  const enfTx=await w(cAuthor,"enforce",[idA],0n);
  xa=await readJson(cOp,"get_item",[idA]);
  const hA=(xa.history||[]); const noteA=hA.length?hA[hA.length-1].note:"";
  console.log("  A status:",xa.status,"| last note:",noteA,"| stake_outcome:",xa.stake_outcome);

  console.log("=== B) RECLAIM appeal after timeout ===");
  const idB=await mkItem();
  await w(cAuthor,"ingest",[idB,U_MILD],MIN_STAKE);
  await w(cOp,"moderate",[idB],0n);
  await w(cOp,"enforce",[idB],0n);
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
    demo_deploy_tx:String(dHash),
    permissionless_enforce_tx:String(enfTx),
    permissionless_enforce_item:idA,
    permissionless_enforce_note:noteA,
    reclaim_appeal_tx:String(reclaimTx),
    reclaim_appeal_item:idB,
    reclaim_appeal_outcome:xb.appeal_outcome,
    explorer:{
      address:EX+"/address/"+ADDRESS,
      deploy:EX+"/tx/"+dHash,
      permissionless_enforce:EX+"/tx/"+enfTx,
      reclaim_appeal:EX+"/tx/"+reclaimTx
    }
  };
  writeFileSync("registry-demo-evidence.json",JSON.stringify(evidence,null,2));
  console.log("=== DEMO EVIDENCE (saved to registry-demo-evidence.json) ===");
  console.log(JSON.stringify(evidence,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
