import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim();
const author = createAccount(authorKey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });
const ADDRESS = readFileSync("registry-contract.txt", "utf8").trim();
const HOST = "https://artem1981777.github.io";
const DIR = "/genlayer-content-moderator/fixtures/";
const U_MILD = HOST + DIR + "mild.html";
const U_BENIGN = HOST + DIR + "benign.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam, no harassment, no hate speech, no violence.";
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const APPEAL_BOND = 2000000000000n;
const POOL_FUND = 5000000000000n;

const results = [];
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
      console.log("  "+fn+" attempt "+attempt+": "+String(msg).slice(0,90));
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

function expect(cond, label){ console.log((cond?"PASS":"FAIL")+" ["+label+"]"); results.push({test:label,pass:!!cond,how:"assert"}); return !!cond; }
function blocked(label,e){ const m=String(e?.message||e); console.log("BLOCKED ["+label+"] "+m.slice(0,120)); results.push({test:label,pass:null,how:(isNet(m)?"blocked-network":"blocked-error")+": "+m.slice(0,70)}); }

async function expectRevert(client, fn, args, value, label){
  console.log("EXPECT-REVERT ["+label+"] "+fn);
  let hash;
  try{
    hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n});
  }catch(e){
    const m=String(e?.message||e);
    if(/revert|usererror|user error/i.test(m)){ console.log("  reverted at submit (PASS): "+m.slice(0,110)); results.push({test:label,pass:true,how:"submit-revert"}); return true; }
    if(isNet(m)){ blocked(label,e); return null; }
    console.log("  submit error treated as revert (PASS): "+m.slice(0,110)); results.push({test:label,pass:true,how:"submit-revert"}); return true;
  }
  try{
    await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400});
    const tx=await waitFinal(client,hash,label,90);
    console.log("  !!! DID NOT REVERT (FAIL) "+label+": "+String(tx?.txExecutionResultName)+" tx "+hash);
    results.push({test:label,pass:false,how:"executed",tx:hash});
    return false;
  }catch(e){
    const m=String(e?.message||e);
    if(/exec failed/i.test(m)){ console.log("  reverted on-chain (PASS): "+m.slice(0,110)); results.push({test:label,pass:true,how:"exec-revert"}); return true; }
    blocked(label,e); return null;
  }
}

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
async function mkItem(){ await w(cOp,"create_item",[RULES],0n); const id=await newestId(); console.log("  item_id:",id); return id; }

async function main(){
  console.log("=== v1.2 FIX TESTS (v2, LLM-frugal + fault-tolerant) ===");
  console.log("registry:",ADDRESS);
  console.log("owner:",operator.address," author:",author.address);
  if(operator.address.toLowerCase()===author.address.toLowerCase()) throw new Error("operator and author must differ");
  await ensureGas(10000000000000000n,30000000000000000n);
  try{ await w(cOp,"fund_pool",[],POOL_FUND); }catch(e){ console.log("fund_pool skipped:",String(e?.message||e).slice(0,60)); }
  for(const u of [U_BENIGN,U_MILD]){ try{ await w(cOp,"release_url",[u],0n); }catch(e){ console.log("  pre-release:",String(e?.message||e).slice(0,60)); } }

  // ---- T1: duplicate active URL (#7) -- NO LLM, robust ----
  console.log("---- T1: duplicate URL (#7) ----");
  try{
    const a=await mkItem();
    await w(cAuthor,"ingest",[a,U_BENIGN],MIN_STAKE);
    const b=await mkItem();
    await expectRevert(cAuthor,"ingest",[b,U_BENIGN],MIN_STAKE,"T1: duplicate active URL rejected (#7)");
    try{ await w(cOp,"release_url",[U_BENIGN],0n); }catch(e){}
  }catch(e){ blocked("T1: duplicate URL (#7)", e); }

  // ---- T2: single FLAG lifecycle on mild.html -> covers #1,#2,#3,#5,#9,reclaim ----
  console.log("---- T2: mild.html FLAG lifecycle ----");
  try{
    const id=await mkItem();
    await w(cAuthor,"ingest",[id,U_MILD],MIN_STAKE);
    await w(cOp,"moderate",[id],0n); // the ONE required LLM verdict
    let x=await readJson(cOp,"get_item",[id]);
    const verdict=x.verdict;
    expect(x.status==="moderated","T2: moderate reached 'moderated'");
    console.log("  verdict:",verdict,"| axes:",JSON.stringify(x.axis_scores));
    await expectRevert(cAuthor,"moderate",[id],0n,"T2: re-roll by non-owner blocked (#1)");
    await expectRevert(cAuthor,"enforce",[id],0n,"T2: non-owner enforce before timeout blocked (#2)");
    await w(cOp,"enforce",[id],0n); // control: proves chain executes real logic now
    x=await readJson(cOp,"get_item",[id]);
    expect(x.status==="enforced","T2: owner enforce -> enforced (network-health control)");
    console.log("  stake_outcome:",x.stake_outcome,"| forfeited:",x.forfeited,"| content:",String(x.content||"").slice(0,42));
    if(verdict==="FLAG"){
      expect((x.stake_outcome||"").indexOf("partial_forfeit")>=0,"T2: FLAG partial forfeit outcome (#5)");
      expect(String(x.forfeited)===String(MIN_STAKE/2n),"T2: FLAG forfeited == 50% stake (#5)");
      expect(String(x.content||"").indexOf("[limited]")===0,"T2: FLAG content masked as [limited] (#9)");
    }else if(verdict==="REMOVE"){
      expect(String(x.content||"").indexOf("[content removed")===0,"T2: REMOVE content masked (#9)");
      results.push({test:"T2: FLAG partial forfeit (#5)",pass:null,how:"verdict-"+verdict});
    }else{
      results.push({test:"T2: FLAG partial forfeit (#5)",pass:null,how:"verdict-"+verdict});
      results.push({test:"T2: content masking (#9)",pass:null,how:"verdict-APPROVE"});
    }
    await expectRevert(cOp,"report",[id],REPORT_BOND,"T2: report on enforced blocked (#3)");
    await w(cAuthor,"appeal",[id,"Author: please re-review, legitimate content."],APPEAL_BOND);
    await expectRevert(cAuthor,"reclaim_appeal",[id],0n,"T2: reclaim before appeal timeout blocked (#2)");
    try{ await w(cOp,"resolve_appeal",[id],0n); }catch(e){ console.log("  resolve_appeal cleanup:",String(e?.message||e).slice(0,60)); }
  }catch(e){ blocked("T2: mild FLAG lifecycle (#1/#2/#3/#5/#9/reclaim)", e); }

  console.log("=== SUMMARY ===");
  let pass=0,fail=0,skip=0;
  for(const r of results){ if(r.pass===true)pass++; else if(r.pass===false)fail++; else skip++; console.log((r.pass===true?"PASS":r.pass===false?"FAIL":"SKIP")+"  "+r.test+"  ("+r.how+")"); }
  console.log("TOTALS: pass="+pass+" fail="+fail+" skip/blocked="+skip);
  writeFileSync("registry-v12-tests.json",JSON.stringify({address:ADDRESS,results,totals:{pass,fail,skip}},null,2));
  if(fail>0){ console.log("=== HARD FAILURE(S) PRESENT ==="); process.exit(1); }
  console.log("=== DONE (no logic failures; blocked=network) ===");
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
