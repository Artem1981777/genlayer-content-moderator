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
const MILD_URL = HOST + DIR + "mild.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam or advertising. No harassment, no hate speech, no violence.";

const MIN_STAKE = 1000000000000n;

const txs = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function retriable(msg){ msg=String(msg||"").toLowerCase(); return msg.includes("-32005")||msg.includes("capacity")||msg.includes("rate limit")||msg.includes("exceeds defined limit")||msg.includes("consensus contract")||msg.includes("evm tx")||msg.includes("fetch failed")||msg.includes("finished_with_error")||msg.includes("not_voted")||msg.includes("timeout"); }

async function waitFinal(client, hash, label, maxIters){
  for(let i=0;i<(maxIters||60);i++){
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
      await waitFinal(client,hash,fn,60);
      console.log("  "+fn+" tx:",hash);
      return hash;
    }catch(e){
      const msg=e?.message||String(e);
      console.log("  "+fn+" attempt "+attempt+": "+msg.slice(0,90));
      if(retriable(msg)&&attempt<12){ await sleep(15000); continue; }
      throw e;
    }
  }
}
async function readJson(client, fn, args){
  const raw=await client.readContract({address:ADDRESS,functionName:fn,args:args||[]});
  if(typeof raw==="string"){ if(raw==="") return null; try{ return JSON.parse(raw); }catch(e){ return raw; } }
  return raw;
}
async function createAndGetId(){
  const before=new Set((await readJson(cOp,"get_item_ids",[]))||[]);
  const h=await w(cOp,"create_item",[RULES],0n);
  for(let i=0;i<45;i++){
    const ids=(await readJson(cOp,"get_item_ids",[]))||[];
    const fresh=ids.filter((x)=>!before.has(x));
    if(fresh.length){ return { id:fresh[fresh.length-1], tx:h }; }
    await sleep(4000);
  }
  throw new Error("could not resolve new item id after create");
}
async function waitStatus(id, wanted, maxIters){
  for(let i=0;i<(maxIters||30);i++){
    const it=await readJson(cOp,"get_item",[id]);
    if(it && wanted.includes(it.status)) return it;
    await sleep(5000);
  }
  return await readJson(cOp,"get_item",[id]);
}
async function ensureGas(minWei, topupWei){
  const b=await cOp.getBalance({address:author.address});
  console.log("author balance:",b.toString());
  if(b<minWei){
    let h;
    try{ h=await cOp.sendTransaction({to:author.address,value:topupWei}); }
    catch(e){ h=await cOp.sendTransaction({account:operator,to:author.address,value:topupWei}); }
    console.log("topup tx:",h);
    for(let i=0;i<25;i++){ const nb=await cOp.getBalance({address:author.address}); if(nb>=minWei){ break; } await sleep(6000); }
  }
}
async function ingestUntilReady(id, url, maxRounds){
  for(let round=1; round<=(maxRounds||8); round++){
    let it=await readJson(cOp,"get_item",[id]);
    if(it && it.status==="ingested"){ console.log("  READY (status ingested, hash "+String(it.content_hash||"").slice(0,10)+", len "+(it.content_len??"?")+")"); return it; }
    console.log("  ingest round "+round+" (current status "+(it?it.status:"?")+")");
    try{ const h=await w(cAuthor,"ingest",[id,url],MIN_STAKE); txs["ingest_r"+round]=h; }
    catch(e){ console.log("  ingest round "+round+" threw: "+String(e?.message||e).slice(0,90)); }
    for(let i=0;i<15;i++){
      it=await readJson(cOp,"get_item",[id]);
      if(it && it.status==="ingested"){ console.log("  status -> ingested (hash "+String(it.content_hash||"").slice(0,10)+", len "+(it.content_len??"?")+")"); return it; }
      await sleep(6000);
    }
  }
  return await readJson(cOp,"get_item",[id]);
}
async function main(){
  console.log("registry v1.1:",ADDRESS);
  console.log("operator:",operator.address,"| author:",author.address);
  await ensureGas(10000000000000000n,30000000000000000n);
  const rec={label:"flag_mild"};
  const c=await createAndGetId(); const id=c.id; rec.item_id=id; txs.create=c.tx;
  console.log("item_id:",id);
  const ing=await ingestUntilReady(id, MILD_URL, 8);
  if(!ing || ing.status!=="ingested"){
    console.log("INGEST NEVER READY, aborting. last status:", ing?ing.status:"null");
    writeFileSync("registry-flag-seed.json",JSON.stringify({address:ADDRESS,rec,txs,lastItem:ing},null,2));
    return;
  }
  txs.moderate=await w(cOp,"moderate",[id],0n);
  await waitStatus(id,["moderated"],20);
  let it=await readJson(cOp,"get_item",[id]);
  rec.verdict=it.verdict; rec.category=it.category; rec.confidence=it.confidence; rec.axes=it.axis_scores;
  console.log("VERDICT:",it.verdict,"| category:",it.category,"| conf:",it.confidence,"| axes:",JSON.stringify(it.axis_scores));
  if(it.verdict==="FLAG"){
    txs.enforce=await w(cOp,"enforce",[id],0n);
    it=await readJson(cOp,"get_item",[id]);
    rec.stake_outcome=it.stake_outcome; rec.enforcement=it.enforcement_action; rec.ok=true;
    console.log("ENFORCED:",it.enforcement_action,"| stake_outcome:",it.stake_outcome);
    console.log("*** FLAG SEEDED SUCCESSFULLY ***");
  } else {
    rec.ok=false; rec.note="verdict was "+it.verdict+", not FLAG - tune fixture";
    console.log("NOT FLAG ("+it.verdict+"). Not enforcing. Need to tune fixture into 50-79 top axis.");
  }
  const all=await readJson(cOp,"get_all_items",[0,50]);
  const payouts=await readJson(cOp,"get_payouts",[]);
  writeFileSync("registry-flag-seed.json",JSON.stringify({address:ADDRESS,explorer:"https://explorer-bradbury.genlayer.com",rec,txs,total:all.total,payouts},null,2));
  console.log("=== TX HASHES ==="); for(const k of Object.keys(txs)){ console.log(k+":",txs[k]); }
  console.log("=== DONE ===");
}
main().catch((e)=>{ console.error("FATAL:",e?.message||e); process.exit(1); });
