import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { throw new Error("PRIVATE_KEY not found. Run: node --env-file=.env interact.mjs"); }
const CONTRACT = readFileSync("contract.txt", "utf8").trim();
const CONTENT = "FREE CRYPTO!! Send 1 ETH to 0xGiveaway and get 10 ETH back instantly! Limited time only. DM me your wallet seed phrase now to claim your reward before it ends!!!";
console.log("CONTRACT:", CONTRACT);
const account = createAccount(PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = () => client.readContract({ address: CONTRACT, functionName: "get_state", args: [] });
const readContent = () => client.readContract({ address: CONTRACT, functionName: "read_content", args: [] });
const verify = (c) => client.readContract({ address: CONTRACT, functionName: "verify_content", args: [c] });
const isCollision = (e) => { const m = String(e?.message || e); return m.includes("consensus contract") || m.includes("EVM tx"); };
async function submitWrite(fn, args) {
  for (let attempt = 1; attempt <= 25; attempt++) {
    try { return await client.writeContract({ address: CONTRACT, functionName: fn, args, value: 0 }); }
    catch (e) {
      if (isCollision(e)) { console.log("  submit collision (prior tx finalizing), retry in 20s..."); await sleep(20000); continue; }
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
async function waitResult(h) {
  for (let i = 0; i < 120; i++) { const tx = await client.getTransaction({ hash: h }); const r = tx?.txExecutionResultName; if (r && r !== "NOT_VOTED") return r; await sleep(5000); }
  return "NOT_VOTED";
}
async function step(fn, args, target) {
  console.log("--- " + fn + " ---");
  const h = await submitWrite(fn, args);
  console.log(fn + " tx:", h);
  await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
  console.log("  waiting for " + fn + " to COMMIT (status -> " + target + ")...");
  const s = await waitStatus(target, 220);
  if (!s || s.status !== target) {
    console.log("!!! " + fn + " DID NOT COMMIT. status:", s?.status, "| result:", await waitResult(h));
    console.log("Consensus likely stalled. Re-run this step or redeploy.");
    process.exit(1);
  }
  console.log("  -> status:", s.status, "| verdict:", s.verdict, "| action:", s.enforcement_action, "| blocked:", s.blocked, "| limited:", s.limited, "| outcome:", s.appeal_outcome);
  return h;
}
console.log("=== 1) STATE (before) ===");
const s0 = await read();
console.log("  status:", s0?.status, "| item_id:", s0?.item_id, "| source:", s0?.source);
console.log("  author:", s0?.author);
console.log("  content_hash:", s0?.content_hash);
console.log("=== 2) MODERATE ===");
const hMod = await step("moderate", [], "moderated");
console.log("=== 3) INTEGRITY CHECK (before enforcement) ===");
console.log("  read_content:", await readContent());
console.log("  verify_content(original):", await verify(CONTENT));
console.log("  verify_content(tampered):", await verify(CONTENT + " EDITED"));
console.log("=== 4) ENFORCE ===");
const hEnf = await step("enforce", [], "enforced");
console.log("  read_content after enforce:", await readContent());
console.log("=== 5) APPEAL (by author) ===");
const APPEAL_NOTE = "I am the author and I dispute this verdict - please reconsider, I believe my post does not violate the rules.";
const hApp = await step("appeal", [APPEAL_NOTE], "appealed");
console.log("=== 6) RESOLVE APPEAL (re-review by operator) ===");
const hRes = await step("resolve_appeal", [], "resolved");
console.log("=== 7) FINAL STATE ===");
const sf = await read();
console.log("  status:", sf?.status, "| verdict:", sf?.verdict, "| appeal_outcome:", sf?.appeal_outcome, "| blocked:", sf?.blocked, "| action:", sf?.enforcement_action);
console.log("  read_content:", await readContent());
console.log("  verify_content(original):", await verify(CONTENT));
let hist = [];
try { hist = JSON.parse(sf?.history || "[]"); } catch {}
console.log("HISTORY ROUNDS:", hist.length);
for (const it of hist) console.log("  round " + it.round + " [" + it.kind + "] verdict=" + it.verdict + " action=" + it.enforcement_action + " outcome=" + it.appeal_outcome + " by=" + it.by);
writeFileSync("moderate-tx.txt", String(hMod));
writeFileSync("enforce-tx.txt", String(hEnf));
writeFileSync("appeal-tx.txt", String(hApp));
writeFileSync("resolve-tx.txt", String(hRes));
console.log("=== TX HASHES ===");
console.log("moderate:", hMod);
console.log("enforce:", hEnf);
console.log("appeal:", hApp);
console.log("resolve:", hRes);
console.log(">>> DEMO COMPLETE");
