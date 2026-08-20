import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { throw new Error("PRIVATE_KEY not found. Run: node --env-file=.env resume.mjs"); }
const CONTRACT = readFileSync("contract.txt", "utf8").trim();
const CONTENT = "FREE CRYPTO!! Send 1 ETH to 0xGiveaway and get 10 ETH back instantly! Limited time only. DM me your wallet seed phrase now to claim your reward before it ends!!!";
console.log("CONTRACT:", CONTRACT);
const account = createAccount(PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = () => client.readContract({ address: CONTRACT, functionName: "get_state", args: [] });
const readContent = () => client.readContract({ address: CONTRACT, functionName: "read_content", args: [] });
const verify = (c) => client.readContract({ address: CONTRACT, functionName: "verify_content", args: [c] });
const ORDER = { pending: 0, moderated: 1, enforced: 2, appealed: 3, resolved: 4 };
const retriable = (e) => { const m = String(e?.message || e); return m.includes("consensus contract") || m.includes("EVM tx") || m.includes("-32005") || m.includes("capacity") || m.includes("rate limit") || m.includes("exceeds defined limit"); };
async function submitWrite(fn, args) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try { return await client.writeContract({ address: CONTRACT, functionName: fn, args, value: 0 }); }
    catch (e) {
      if (retriable(e)) { console.log("  node busy on " + fn + " (try " + attempt + "), retry in 8s..."); await sleep(8000); continue; }
      throw e;
    }
  }
  throw new Error("submit failed after retries: " + fn);
}
async function waitStatus(target, tries) {
  let s;
  for (let i = 0; i < tries; i++) { s = await read(); if (s?.status === target) return s; await sleep(5000); }
  return s;
}
async function step(fn, args, target, outfile) {
  let s = await read();
  if ((ORDER[s?.status] ?? -1) >= ORDER[target]) { console.log("skip " + fn + " (already " + s?.status + ")"); return; }
  console.log("--- " + fn + " ---");
  const h = await submitWrite(fn, args);
  console.log(fn + " tx:", h);
  if (outfile) writeFileSync(outfile, String(h));
  await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
  console.log("  waiting for " + fn + " to COMMIT (status -> " + target + ")...");
  s = await waitStatus(target, 260);
  if (!s || s.status !== target) { console.log("!!! " + fn + " DID NOT COMMIT. status:", s?.status); process.exit(1); }
  console.log("  -> status:", s.status, "| verdict:", s.verdict, "| action:", s.enforcement_action, "| blocked:", s.blocked, "| outcome:", s.appeal_outcome);
}
const APPEAL_NOTE = "I am the author and I dispute this verdict - please reconsider, I believe my post does not violate the rules.";
console.log("=== RESUME (enforce -> appeal -> resolve) ===");
await step("enforce", [], "enforced", "enforce-tx.txt");
console.log("  read_content after enforce:", await readContent());
await step("appeal", [APPEAL_NOTE], "appealed", "appeal-tx.txt");
await step("resolve_appeal", [], "resolved", "resolve-tx.txt");
console.log("=== FINAL STATE ===");
const sf = await read();
console.log("  status:", sf?.status, "| verdict:", sf?.verdict, "| appeal_outcome:", sf?.appeal_outcome, "| blocked:", sf?.blocked, "| action:", sf?.enforcement_action);
console.log("  read_content:", await readContent());
console.log("  verify_content(original):", await verify(CONTENT));
let hist = [];
try { hist = JSON.parse(sf?.history || "[]"); } catch {}
console.log("HISTORY ROUNDS:", hist.length);
for (const it of hist) console.log("  round " + it.round + " [" + it.kind + "] verdict=" + it.verdict + " action=" + it.enforcement_action + " outcome=" + it.appeal_outcome + " by=" + it.by);
console.log(">>> RESUME COMPLETE");
