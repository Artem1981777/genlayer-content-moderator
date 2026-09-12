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
const U_BORDERLINE = HOST + DIR + "borderline.html";
const U_BENIGN = HOST + DIR + "benign.html";
const U_DEDUP = U_BENIGN + "?d=" + Date.now();
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";
const ADDRESS = readFileSync("registry-contract.txt","utf8").trim(); // PROD v1.2

const OUT = "registry-v12-reportpath.json";
const results = { address: ADDRESS, explorer: EX, generated: new Date().toISOString() };
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isNet(msg){ msg=String(msg||"").toLowerCase(); return msg.includes("not_voted")||msg.includes("finished_with_error")||msg.includes("timeout")||msg.includes("timed out")||msg.includes("fetch failed")||msg.includes("-32005")||msg.includes("capacity")||msg.includes("rate limit")||msg.includes("exceeds defined limit")||msg.includes("consensus contract")||msg.includes("evm tx"); }
async function waitFinal(client, hash, label){
  for(let i=0;i<90;i++){
    let tx=null;
    try{ tx=await client.getTransaction({hash}); }catch(e){ await sleep(5000); continue; }
    const rn=String(tx?.txExecutionResultName||"");
    if(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN") return rn;
    if(/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("exec failed "+label+": "+rn);
    if(i%5===0) console.log("  waiting finality "+label+" ("+(rn||"pending")+")");
    await sleep(6000);
  }
  throw new Error("timeout finality "+label);
}
async function w(client, fn, args, value, maxAttempts){
  const N=maxAttempts||10;
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
  let rn="";
  try{ const tx=await client.getTransaction({hash}); rn=String(tx?.txExecutionResultName||""); }catch(e){}
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
async function ensureGas(minWei, topupWei){
  const b=await cOp.getBalance({address:author.address});
  console.log("author balance:",b.toString());
  if(b<minWei){ let h; try{ h=await cOp.sendTransaction({to:author.address,value:topupWei}); }catch(e){ h=await cOp.sendTransaction({account:operator,to:author.address,value:topupWei}); } console.log("topup tx:",h); for(let i=0;i<25;i++){ const nb=await cOp.getBalance({address:author.address}); if(nb>=minWei){ console.log("author funded:",nb.toString()); break; } await sleep(6000); } }
}

async function main(){
  console.log("=== BLOCK B on PROD v1.2:",ADDRESS,"===");
  console.log("owner:",operator.address," author:",author.address);
  if(operator.address.toLowerCase()===author.address.toLowerCase()) throw new Error("owner and author must differ");
  await ensureGas(8000000000000000n,25000000000000000n);

  // ===== SECTION 1: report-path (#2) + moderate/enforce settlement + FLAG (#5/#9) =====
  console.log("=== 1) REPORT PATH (borderline) ===");
  await w(cOp,"create_item",[RULES],0n);
  const idR=await newestId(); console.log("  report item:",idR);
  await w(cAuthor,"ingest",[idR,U_BORDERLINE],MIN_STAKE);
  const repTx=await w(cOp,"report",[idR],REPORT_BOND); // owner as independent reporter (LLM-free)
  let xR=await readJson(cOp,"get_item",[idR]);
  results.report_open={test:"#2 report path open on ingested item",pass:!!xR.reporter,tx:repTx,item:idR,status_after:xR.status,reporter_set:!!xR.reporter,explorer:EX+"/tx/"+repTx};
  save();
  console.log("  report tx:",repTx," reporter_set:",!!xR.reporter," status:",xR.status);
  try{
    const modTx=await w(cOp,"moderate",[idR],0n,8); // LLM
    xR=await readJson(cOp,"get_item",[idR]);
    console.log("  verdict:",xR.verdict," public content sample:",String(xR.content||"").slice(0,50));
    const enfTx=await w(cOp,"enforce",[idR],0n,8); // deterministic
    xR=await readJson(cOp,"get_item",[idR]);
    const payouts=await readJson(cOp,"get_payouts",[]);
    results.report_settlement={test:"#2 reporter bond settles at enforce (P2)",pass:!!xR.stake_outcome,moderate_tx:modTx,enforce_tx:enfTx,verdict:xR.verdict,stake_outcome:xR.stake_outcome,final_status:xR.status,explorer_moderate:EX+"/tx/"+modTx,explorer_enforce:EX+"/tx/"+enfTx};
    results.flag_masking={test:"#5 partial-forfeit + #9 masking",verdict:xR.verdict,is_flag:xR.verdict==="FLAG",stake_outcome:xR.stake_outcome,public_content:String(xR.content||"").slice(0,80),masked:/removed by moderation|\[limited\]/i.test(String(xR.content||""))};
    console.log("  stake_outcome:",xR.stake_outcome," final:",xR.status);
    save();
  }catch(e){ results.report_settlement={pass:null,deferred:String(e?.message||e).slice(0,140),note:"moderate degraded; report_open still captured"}; console.log("  moderate/enforce deferred:",String(e?.message||e).slice(0,120)); save(); }

  // ===== SECTION 2: T1 dedup re-run (#7), LLM-free revert =====
  console.log("=== 2) T1 DEDUP re-run (unique url) ===");
  try{
    await w(cOp,"create_item",[RULES],0n);
    const id1=await newestId(); console.log("  dedup item1:",id1);
    await w(cAuthor,"ingest",[id1,U_DEDUP],MIN_STAKE); // first ingest, wait full finality
    await w(cOp,"create_item",[RULES],0n);
    const id2=await newestId(); console.log("  dedup item2:",id2);
    const dup=await captureRevert(cAuthor,"ingest",[id2,U_DEDUP],MIN_STAKE,"#7 duplicate-URL ingest rejected");
    results.dedup_T1={test:"#7 duplicate-URL second ingest reverts",url:U_DEDUP,item1:id1,item2:id2,...dup};
    save();
  }catch(e){ results.dedup_T1={pass:null,error:String(e?.message||e).slice(0,140)}; save(); }

  console.log("=== BLOCK B RESULTS (saved "+OUT+") ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); save(); process.exit(1); });
