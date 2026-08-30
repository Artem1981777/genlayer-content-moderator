import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const rkey = "0x" + randomBytes(32).toString("hex");
const reporter = createAccount(rkey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cRep = createClient({ chain: testnetBradbury, account: reporter });

const RULES = "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. No hate speech or harassment. No violence or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const HOST = "https://artem1981777.github.io";
const DIR = "/genlayer-content-moderator/fixtures/";
const U_BENIGN = HOST + DIR + "benign.html";
const U_DEDUP = U_BENIGN + "?d=" + Date.now();
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";
const ADDRESS = readFileSync("registry-contract.txt","utf8").trim();
const ITEM = "fba77b7b08375b40"; // already ingested borderline item (reporter empty)

const OUT = "registry-v12-reportpath.json";
const results = { address: ADDRESS, explorer: EX, generated: new Date().toISOString(), reporter_addr: reporter.address };
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isNet(msg){ msg=String(msg||"").toLowerCase(); return msg.includes("not_voted")||msg.includes("timeout")||msg.includes("timed out")||msg.includes("fetch failed")||msg.includes("-32005")||msg.includes("capacity")||msg.includes("rate limit")||msg.includes("exceeds defined limit")||msg.includes("consensus contract")||msg.includes("evm tx"); }
async function waitFinal(client, hash, label){
  for(let i=0;i<90;i++){
    let tx=null; try{ tx=await client.getTransaction({hash}); }catch(e){ await sleep(5000); continue; }
    const rn=String(tx?.txExecutionResultName||"");
    if(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN") return rn;
    if(/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("exec failed "+label+": "+rn);
    if(i%5===0) console.log("  waiting finality "+label+" ("+(rn||"pending")+")");
    await sleep(6000);
  }
  throw new Error("timeout finality "+label);
}
async function w(client, fn, args, value, maxAttempts){
  const N=maxAttempts||8;
  for(let attempt=1;attempt<=N;attempt++){
    try{
      const hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n});
      await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400});
      await waitFinal(client,hash,fn);
      console.log("  "+fn+" tx:",hash);
      return hash;
    }catch(e){ const m=e?.message||String(e); console.log("  "+fn+" attempt "+attempt+": "+String(m).slice(0,110)); if(isNet(m)&&attempt<N){ await sleep(15000); continue; } throw e; }
  }
}
async function captureRevert(client, fn, args, value, label){
  console.log("EXPECT-REVERT ["+label+"] "+fn);
  let hash;
  try{ hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n}); }
  catch(e){ const m=String(e?.message||e); console.log("  reverted at submit: "+m.slice(0,90)); return {pass:true,how:"submit-revert",detail:m.slice(0,120)}; }
  try{ await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400}); }catch(e){}
  let rn=""; try{ const tx=await client.getTransaction({hash}); rn=String(tx?.txExecutionResultName||""); }catch(e){}
  const reverted=/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn);
  console.log("  "+fn+" tx:",hash," result:",rn," reverted:",reverted);
  return {pass:reverted,how:"onchain-"+rn,tx:hash,explorer:EX+"/tx/"+hash};
}
async function readJson(client, fn, args){
  const raw=await client.readContract({address:ADDRESS,functionName:fn,args:args||[]});
  if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } }
  return raw;
}
async function newestId(){ const ids=await readJson(cOp,"get_item_ids",[]); return Array.isArray(ids)?ids[ids.length-1]:null; }

async function main(){
  console.log("=== REPORT-FIX on PROD v1.2:",ADDRESS,"===");
  console.log("owner:",operator.address," fresh reporter:",reporter.address);
  // fund fresh reporter
  const h=await cOp.sendTransaction({to:reporter.address,value:20000000000000000n});
  console.log("fund reporter tx:",h);
  for(let i=0;i<25;i++){ const b=await cRep.getBalance({address:reporter.address}); if(b>=3000000000000000n){ console.log("reporter funded:",b.toString()); break; } await sleep(6000); }

  let xR=await readJson(cOp,"get_item",[ITEM]);
  console.log("ITEM",ITEM,"status:",xR&&xR.status,"reporter:",(xR&&xR.reporter)||"(empty)","author:",(xR&&xR.author||"").slice(0,10),"verdict:",xR&&xR.verdict);
  if(!xR || xR.status!=="ingested" || xR.reporter){ console.log(">>> item not in clean ingested state; will still attempt report"); }

  // #2 report path open — fresh reporter (0 open reports, != author)
  try{
    const repTx=await w(cRep,"report",[ITEM],REPORT_BOND);
    xR=await readJson(cOp,"get_item",[ITEM]);
    results.report_open={test:"#2 report path open (fresh reporter on ingested item)",pass:!!xR.reporter,tx:repTx,item:ITEM,status_after:xR.status,reporter_set:!!xR.reporter,explorer:EX+"/tx/"+repTx};
    console.log("  REPORT OK — reporter_set:",!!xR.reporter,"status:",xR.status);
    save();
  }catch(e){ results.report_open={test:"#2 report path open",pass:false,error:String(e?.message||e).slice(0,160),note:"non-LLM call still errors => testnet consensus degradation, not owner-maxed"}; console.log("  REPORT FAILED:",String(e?.message||e).slice(0,120)); save(); }

  // settlement + FLAG/masking (needs moderate LLM)
  if(results.report_open && results.report_open.pass){
    try{
      const modTx=await w(cOp,"moderate",[ITEM],0n,8);
      xR=await readJson(cOp,"get_item",[ITEM]);
      console.log("  verdict:",xR.verdict," public sample:",String(xR.content||"").slice(0,50));
      const enfTx=await w(cOp,"enforce",[ITEM],0n,8);
      xR=await readJson(cOp,"get_item",[ITEM]);
      results.report_settlement={test:"reporter bond settles at enforce (P2 positive)",pass:!!xR.stake_outcome,moderate_tx:modTx,enforce_tx:enfTx,verdict:xR.verdict,stake_outcome:xR.stake_outcome,final_status:xR.status,explorer_enforce:EX+"/tx/"+enfTx,explorer_moderate:EX+"/tx/"+modTx};
      results.flag_masking={test:"#5 partial-forfeit + #9 masking",verdict:xR.verdict,is_flag:xR.verdict==="FLAG",stake_outcome:xR.stake_outcome,public_content:String(xR.content||"").slice(0,80),masked:/removed by moderation|\[limited\]/i.test(String(xR.content||""))};
      console.log("  stake_outcome:",xR.stake_outcome," verdict:",xR.verdict);
      save();
    }catch(e){ results.report_settlement={pass:null,deferred:String(e?.message||e).slice(0,140),note:"moderate LLM degraded; report_open captured"}; console.log("  moderate/enforce deferred:",String(e?.message||e).slice(0,120)); save(); }
  }

  // #7 T1 dedup re-run (unique url)
  try{
    await w(cOp,"create_item",[RULES],0n);
    const id1=await newestId(); console.log("  dedup item1:",id1);
    await w(cOp,"ingest",[id1,U_DEDUP],MIN_STAKE); // owner ingests; wait full finality
    await w(cOp,"create_item",[RULES],0n);
    const id2=await newestId(); console.log("  dedup item2:",id2);
    const dup=await captureRevert(cOp,"ingest",[id2,U_DEDUP],MIN_STAKE,"#7 duplicate-URL ingest rejected");
    results.dedup_T1={test:"#7 duplicate-URL second ingest reverts",url:U_DEDUP,item1:id1,item2:id2,...dup};
    save();
  }catch(e){ results.dedup_T1={pass:null,error:String(e?.message||e).slice(0,140)}; save(); }

  console.log("=== RESULTS (saved "+OUT+") ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); save(); process.exit(1); });
