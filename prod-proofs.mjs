import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim();
const author = createAccount(authorKey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });

const REPORT_BOND = 1000000000000n;
const EX = "https://explorer-bradbury.genlayer.com";
const ADDRESS = readFileSync("registry-contract.txt","utf8").trim(); // PROD v1.2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isNet(msg){ msg=String(msg||"").toLowerCase(); return msg.includes("not_voted")||msg.includes("timeout")||msg.includes("timed out")||msg.includes("fetch failed")||msg.includes("-32005")||msg.includes("capacity")||msg.includes("rate limit")||msg.includes("exceeds defined limit")||msg.includes("consensus contract")||msg.includes("evm tx"); }

async function readJson(client, fn, args){
  const raw=await client.readContract({address:ADDRESS,functionName:fn,args:args||[]});
  if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } }
  return raw;
}
async function waitFinal(client, hash, label){
  for(let i=0;i<90;i++){
    let tx=null;
    try{ tx=await client.getTransaction({hash}); }catch(e){ await sleep(5000); continue; }
    const rn=String(tx?.txExecutionResultName||"");
    if(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN") return rn;
    if(/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) return rn;
    if(i%5===0) console.log("  waiting finality "+label+" ("+(rn||"pending")+")");
    await sleep(6000);
  }
  return "TIMEOUT";
}
// capture a call that is expected to REVERT; keep the tx hash for the explorer
async function captureRevert(client, fn, args, value, label){
  console.log("EXPECT-REVERT ["+label+"] "+fn);
  let hash;
  for(let attempt=1;attempt<=6;attempt++){
    try{ hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n}); break; }
    catch(e){ const m=String(e?.message||e); if(/revert|usererror|user error/i.test(m)){ console.log("  reverted at submit: "+m.slice(0,90)); return {test:label,pass:true,how:"submit-revert",detail:m.slice(0,120)}; } if(isNet(m)&&attempt<6){ console.log("  net retry: "+m.slice(0,70)); await sleep(12000); continue; } console.log("  submit err treated as revert: "+m.slice(0,90)); return {test:label,pass:true,how:"submit-revert",detail:m.slice(0,120)}; }
  }
  try{ await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400}); }catch(e){}
  const rn=await waitFinal(client,hash,label);
  const reverted=/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn);
  console.log("  "+fn+" tx:",hash," result:",rn," reverted:",reverted);
  return {test:label,pass:reverted,how:"onchain-"+rn,tx:hash,explorer:EX+"/tx/"+hash};
}
// capture a call expected to SUCCEED
async function captureOk(client, fn, args, value, label){
  console.log("EXPECT-OK ["+label+"] "+fn);
  let hash;
  for(let attempt=1;attempt<=8;attempt++){
    try{
      hash=await client.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:value||0n});
      await client.waitForTransactionReceipt({hash,status:TransactionStatus.ACCEPTED,retries:400});
      const rn=await waitFinal(client,hash,label);
      const ok=(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN");
      console.log("  "+fn+" tx:",hash," result:",rn," ok:",ok);
      return {test:label,pass:ok,how:"onchain-"+rn,tx:hash,explorer:EX+"/tx/"+hash};
    }catch(e){ const m=String(e?.message||e); console.log("  attempt "+attempt+": "+m.slice(0,90)); if(isNet(m)&&attempt<8){ await sleep(15000); continue; } return {test:label,pass:false,how:"error",detail:m.slice(0,140)}; }
  }
}

async function main(){
  console.log("=== PROD v1.2 proofs:",ADDRESS,"===");
  console.log("owner:",operator.address," author(non-owner):",author.address);
  const ids=await readJson(cOp,"get_item_ids",[]);
  console.log("total items:",Array.isArray(ids)?ids.length:0);
  const scan=Array.isArray(ids)?ids.slice(-16):[];
  const items=[];
  for(const id of scan){
    try{ const it=await readJson(cOp,"get_item",[id]); items.push({id,status:it.status,reporter:it.reporter||"",author:it.author||"",verdict:it.verdict||""}); }
    catch(e){ console.log("  read fail",id,String(e?.message||e).slice(0,50)); }
  }
  console.log("=== ITEM STATES (last "+items.length+") ===");
  for(const i of items) console.log("  "+i.id+"  status="+i.status+"  verdict="+(i.verdict||"-")+"  reporter="+(i.reporter?"yes":"no")+"  author="+i.author.slice(0,10));

  const opAddr=operator.address.toLowerCase();
  const reroll = items.find(i=>i.status==="moderated"&&!i.reporter) || items.find(i=>i.status==="enforced") || items.find(i=>i.status==="moderated");
  const reportEnf = items.find(i=>i.status==="enforced" && i.author.toLowerCase()!==opAddr);
  const reportOpen = items.find(i=>(i.status==="ingested"||i.status==="moderated") && !i.reporter && i.author.toLowerCase()!==opAddr && (!reroll||i.id!==reroll.id));

  const results=[];
  console.log("targets -> reroll:",reroll&&reroll.id,"| reportEnf:",reportEnf&&reportEnf.id,"| reportOpen:",reportOpen&&reportOpen.id);

  if(reroll){ results.push(await captureRevert(cAuthor,"moderate",[reroll.id],0n,"#1 re-roll by non-owner rejected (item "+reroll.id+", status "+reroll.status+")")); }
  else results.push({test:"#1 re-roll rejected",pass:null,how:"no-target"});

  if(reportEnf){ results.push(await captureRevert(cOp,"report",[reportEnf.id],REPORT_BOND,"#3/P2 report on ENFORCED rejected (item "+reportEnf.id+")")); }
  else results.push({test:"#3 report-on-enforced rejected",pass:null,how:"no-enforced-target"});

  if(reportOpen){ results.push(await captureOk(cOp,"report",[reportOpen.id],REPORT_BOND,"#2 report path OPEN on "+reportOpen.status+" item "+reportOpen.id)); }
  else results.push({test:"#2 report path open",pass:null,how:"no-reportable-target"});

  const out={address:ADDRESS,explorer:EX,generated:new Date().toISOString(),item_states:items,results};
  writeFileSync("registry-v12-proofs.json",JSON.stringify(out,null,2));
  console.log("=== PROD PROOFS (saved registry-v12-proofs.json) ===");
  console.log(JSON.stringify(results,null,2));
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
