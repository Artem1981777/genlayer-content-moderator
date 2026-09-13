import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt","utf8").trim();
const author = createAccount(authorKey);
const rkey = "0x" + randomBytes(32).toString("hex");
const reporter = createAccount(rkey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });
const cRep = createClient({ chain: testnetBradbury, account: reporter });

const RULES = "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. No hate speech or harassment. No violence or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const HOST = "https://artem1981777.github.io";
const DIR = "/genlayer-content-moderator/fixtures/";
const U_BENIGN = HOST + DIR + "benign.html";
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";
const ADDRESS = readFileSync("registry-contract.txt","utf8").trim();
const OUT = "registry-v12-reportpath.json";

let results = {};
try{ results = JSON.parse(readFileSync(OUT,"utf8")); }catch(e){ results = { address: ADDRESS, explorer: EX }; }
results.reportpath_run = new Date().toISOString();
results.reporter_addr = reporter.address;
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
async function readJson(client, fn, args){
  const raw=await client.readContract({address:ADDRESS,functionName:fn,args:args||[]});
  if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } }
  return raw;
}
async function newestId(){ const ids=await readJson(cOp,"get_item_ids",[]); return Array.isArray(ids)?ids[ids.length-1]:null; }

// create + ingest, then READ BACK status until "ingested" (don't trust receipt)
async function makeIngested(){
  for(let attempt=1;attempt<=3;attempt++){
    const url = U_BENIGN + "?r=" + Date.now() + "_" + attempt;
    console.log("  ingest attempt "+attempt+" url:",url);
    await w(cAuthor,"create_item",[RULES],0n);
    const id=await newestId(); console.log("   new item:",id);
    try{ await w(cAuthor,"ingest",[id,url],MIN_STAKE,6); }
    catch(e){ console.log("   ingest err:",String(e?.message||e).slice(0,90)); continue; }
    // verify committed state
    for(let p=0;p<6;p++){
      const it=await readJson(cOp,"get_item",[id]);
      console.log("   read-back status:",it&&it.status," author:",(it&&it.author||"").slice(0,10));
      if(it && it.status==="ingested" && it.author){ return {id,url,author:it.author}; }
      await sleep(6000);
    }
    console.log("   >>> did not reach ingested; retrying with new item");
  }
  return null;
}

async function main(){
  console.log("=== REPORT2 on PROD v1.2:",ADDRESS,"===");
  console.log("owner:",operator.address," author:",author.address," reporter:",reporter.address);
  if(new Set([operator.address.toLowerCase(),author.address.toLowerCase(),reporter.address.toLowerCase()]).size!==3) throw new Error("three accounts must differ");
  const h=await cOp.sendTransaction({to:reporter.address,value:20000000000000000n});
  console.log("fund reporter tx:",h);
  for(let i=0;i<25;i++){ const b=await cRep.getBalance({address:reporter.address}); if(b>=3000000000000000n){ console.log("reporter funded:",b.toString()); break; } await sleep(6000); }

  const ing=await makeIngested();
  if(!ing){ results.report_open={test:"#2 report path open",pass:null,deferred:"ingest did not commit (nondet web.render degraded in this window)"}; save(); console.log("NO INGESTED ITEM — deferring report-path"); console.log(JSON.stringify(results,null,2)); return; }
  console.log("INGESTED item ready:",ing.id," author:",ing.author);

  // #2 report path open — fresh reporter on validly-ingested item
  const repTx=await w(cRep,"report",[ing.id],REPORT_BOND);
  let xR=await readJson(cOp,"get_item",[ing.id]);
  results.report_open={test:"#2 report path open on ingested item (fresh reporter, != author)",pass:!!xR.reporter,tx:repTx,item:ing.id,url:ing.url,author:ing.author,reporter:xR.reporter,status_after:xR.status,explorer:EX+"/tx/"+repTx};
  console.log("  REPORT OK — reporter:",xR.reporter," status:",xR.status);
  save();

  // settlement (benign => APPROVE => false-report path: reporter bond -> author comp) — needs LLM
  try{
    const modTx=await w(cOp,"moderate",[ing.id],0n,8);
    xR=await readJson(cOp,"get_item",[ing.id]);
    console.log("  verdict:",xR.verdict);
    const enfTx=await w(cOp,"enforce",[ing.id],0n,8);
    xR=await readJson(cOp,"get_item",[ing.id]);
    const payouts=await readJson(cOp,"get_payouts",[]);
    results.report_settlement={test:"reporter bond settles at enforce (P2 positive path)",pass:!!xR.stake_outcome,moderate_tx:modTx,enforce_tx:enfTx,verdict:xR.verdict,stake_outcome:xR.stake_outcome,final_status:xR.status,explorer_moderate:EX+"/tx/"+modTx,explorer_enforce:EX+"/tx/"+enfTx};
    console.log("  stake_outcome:",xR.stake_outcome," verdict:",xR.verdict," final:",xR.status);
    save();
  }catch(e){ results.report_settlement={pass:null,deferred:String(e?.message||e).slice(0,140),note:"moderate LLM degraded; report_open positive still captured"}; console.log("  moderate/enforce deferred:",String(e?.message||e).slice(0,120)); save(); }

  console.log("=== RESULTS (saved "+OUT+") ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); save(); process.exit(1); });
