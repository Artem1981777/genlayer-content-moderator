import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { throw new Error("PRIVATE_KEY not found. Run: node --env-file=.env interact.mjs"); }
const CONTRACT = readFileSync("contract.txt", "utf8").trim();
console.log("CONTRACT:", CONTRACT);

const account = createAccount(PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = () => client.readContract({ address: CONTRACT, functionName: "get_state", args: [] });
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
async function waitHistory(minLen, tries) {
  let s;
  for (let i = 0; i < tries; i++) { s = await read(); let h = []; try { h = JSON.parse(s?.history || "[]"); } catch {} if (h.length >= minLen) return s; await sleep(5000); }
  return s;
}
async function waitResult(h) {
  for (let i = 0; i < 120; i++) { const tx = await client.getTransaction({ hash: h }); const r = tx?.txExecutionResultName; if (r && r !== "NOT_VOTED") return r; await sleep(5000); }
  return "NOT_VOTED";
}
function show(label, s) {
  console.log(label);
  console.log("  status:", s?.status, "| verdict:", s?.verdict, "| confidence:", s?.confidence, "| category:", s?.category);
  console.log("  escalated:", s?.escalated, "| needs_review:", s?.needs_review);
  console.log("  reason:", s?.reason);
}

console.log("=== 1) READ STATE (before) ===");
console.log(await read());

console.log("=== 2) MODERATE (confidence-gated, auto-escalating) ===");
const h1 = await submitWrite("moderate", []);
console.log("moderate tx:", h1);
await client.waitForTransactionReceipt({ hash: h1, status: TransactionStatus.ACCEPTED, retries: 300 });
console.log("waiting for moderation to COMMIT (up to ~18 min)...");
const moderated = await waitStatus("moderated", 220);
if (!moderated || moderated.status !== "moderated") {
  console.log("!!! MODERATE DID NOT COMMIT. status:", moderated?.status);
  console.log("moderate tx execution result:", await waitResult(h1));
  console.log("Consensus likely stalled this round. Re-run: node --env-file=.env deploy.mjs && node --env-file=.env interact.mjs");
  process.exit(1);
}
show("VERDICT:", moderated);

console.log("=== 3) APPEAL (re-review, should hold a clear verdict) ===");
const APPEAL_NOTE = "I think this was misjudged, please reconsider - it is just a normal message.";
const h2 = await submitWrite("appeal", [APPEAL_NOTE]);
console.log("appeal tx:", h2);
await client.waitForTransactionReceipt({ hash: h2, status: TransactionStatus.ACCEPTED, retries: 300 });
console.log("waiting for appeal to COMMIT (history -> 2)...");
const finalState = await waitHistory(2, 220);
console.log("appeal tx execution result:", await waitResult(h2));

console.log("=== 4) READ STATE (after appeal) ===");
show("FINAL:", finalState);
let hist = [];
try { hist = JSON.parse(finalState?.history || "[]"); } catch {}
console.log("HISTORY ROUNDS:", hist.length);
for (const it of hist) console.log("  round " + it.round + " [" + it.kind + "] -> " + it.verdict + " (conf " + it.confidence + ", " + it.category + ", escalated=" + it.escalated + ")");
console.log("moderate tx:", h1);
console.log("appeal tx:", h2);
writeFileSync("moderate-tx.txt", String(h1));
writeFileSync("appeal-tx.txt", String(h2));
