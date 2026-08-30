import { readFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim();
const author = createAccount(authorKey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });
const ADDRESS = readFileSync("registry-contract.txt", "utf8").trim();
const URL = "https://artem1981777.github.io/genlayer-content-moderator/fixtures/benign.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam, no harassment, no hate speech, no violence.";
const MIN_STAKE = 1000000000000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isNet(m){ m=String(m||"").toLowerCase(); return m.includes("not_voted")||m.includes("finished_with_error")||m.includes("timeout")||m.includes("timed out")||m.includes("fetch failed")||m.includes("-32005")||m.includes("capacity")||m.includes("rate limit")||m.includes("exceeds defined limit")||m.includes("consensus contract")||m.includes("evm tx"); }
async function waitFinal(c,h,l,mx){ for(let i=0;i<(mx||90);i++){ let t=null; try{ t=await c.getTransaction({hash:h}); }catch(e){ await sleep(5000); continue; } const rn=String(t?.txExecutionResultName||""); if(rn==="FINISHED"||rn==="FINISHED_WITH_RETURN") return t; if(/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("exec failed "+l+": "+rn); if(i%5===0) console.log("  waiting "+l+" ("+(rn||"pending")+")"); await sleep(6000); } throw new Error("timeout finality "+l); }
async function w(c,fn,args,val){ for(let a=1;a<=10;a++){ try{ const h=await c.writeContract({address:ADDRESS,functionName:fn,args:args||[],value:val||0n}); await c.waitForTransactionReceipt({hash:h,status:TransactionStatus.ACCEPTED,retries:400}); await waitFinal(c,h,fn,90); console.log("  "+fn+" tx:",h); return h; }catch(e){ const m=e?.message||String(e); console.log("  "+fn+" attempt "+a+": "+String(m).slice(0,80)); if(isNet(m)&&a<10){ await sleep(15000); continue; } throw e; } } }
async function rj(c,fn,args){ const raw=await c.readContract({address:ADDRESS,functionName:fn,args:args||[]}); if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } } return raw; }
async function readRaw(fn,args){ return await cOp.readContract({address:ADDRESS,functionName:fn,args:args||[]}); }
async function newestId(){ const ids=await rj(cOp,"get_item_ids",[]); return Array.isArray(ids)?ids[ids.length-1]:null; }

async function main(){
  console.log("registry:",ADDRESS);
  await w(cOp,"release_url",[URL],0n);
  console.log("[1] after release, get_item_by_url:",JSON.stringify(await readRaw("get_item_by_url",[URL])));
  await w(cOp,"create_item",[RULES],0n); const P=await newestId(); console.log("P =",P);
  await w(cAuthor,"ingest",[P,URL],MIN_STAKE);
  console.log("[2] after ingest P, get_item_by_url:",JSON.stringify(await readRaw("get_item_by_url",[URL])),"(expect == P)");
  console.log("    P status:",(await rj(cOp,"get_item",[P])).status);
  await w(cOp,"create_item",[RULES],0n); const Q=await newestId(); console.log("Q =",Q);
  console.log("[3] EXPECT dedup revert on ingest(Q,URL) ...");
  let reverted=false, netblock=false;
  try{
    const h=await cAuthor.writeContract({address:ADDRESS,functionName:"ingest",args:[Q,URL],value:MIN_STAKE});
    await cAuthor.waitForTransactionReceipt({hash:h,status:TransactionStatus.ACCEPTED,retries:400});
    const t=await waitFinal(cAuthor,h,"ingestQ",90);
    console.log("    ingest(Q) ->",t?.txExecutionResultName,"tx",h,"  (NO REVERT => BUG)");
  }catch(e){ const m=String(e?.message||e); if(/exec failed/i.test(m)){ reverted=true; console.log("    reverted (GOOD):",m.slice(0,100)); } else if(isNet(m)){ netblock=true; console.log("    network-blocked, inconclusive:",m.slice(0,100)); } else { console.log("    other:",m.slice(0,100)); } }
  console.log("[4] after ingest(Q) attempt, get_item_by_url:",JSON.stringify(await readRaw("get_item_by_url",[URL])));
  console.log("    Q status:",(await rj(cOp,"get_item",[Q])).status,"(expect 'created' if dedup worked)");
  console.log(reverted?"=== VERDICT: DEDUP WORKS (#7 OK) ===":netblock?"=== VERDICT: INCONCLUSIVE (network) ===":"=== VERDICT: DEDUP DID NOT REVERT (#7 real bug) ===");
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
