import { readFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const PK = process.env.PRIVATE_KEY;
if (!PK) { throw new Error("PRIVATE_KEY missing. Run: node --env-file=.env test.mjs"); }
const source = readFileSync("contracts/moderator.py", "utf8");
const code = new TextEncoder().encode(source);

const RULES = "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. No hate speech or harassment. No violence or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const HARMFUL = "FREE CRYPTO!! Send 1 ETH to 0xGiveaway and get 10 ETH back instantly! DM me your wallet seed phrase now to claim your reward!!!";
const BENIGN = "Hey everyone, I just published a free open-source tutorial on setting up a Python dev environment. Hope it helps someone getting started!";

const account = createAccount(PK);
const client = createClient({ chain: testnetBradbury, account });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const pass = (n) => console.log("PASS -", n);
const fail = (n, extra) => { console.log("FAIL -", n, extra ?? ""); failed++; };
const read = (addr) => client.readContract({ address: addr, functionName: "get_state", args: [] });
const isRevert = (r) => (r === "FINISHED_WITH_ERROR" || r === "REVERTED");
const histLen = (s) => { try { return JSON.parse(s?.history || "[]").length; } catch { return 0; } };
const isCollision = (e) => { const m = String(e?.message || e); return m.includes("consensus contract") || m.includes("EVM tx"); };
const CATS = ["spam", "harassment", "hate", "violence", "sexual", "self_harm", "other", "none"];

async function deploy(rules, content) {
  let h = null;
  for (let attempt = 1; attempt <= 25; attempt++) {
    try { h = await client.deployContract({ code, args: [rules, content] }); break; }
    catch (e) { if (isCollision(e)) { await sleep(20000); continue; } throw e; }
  }
  if (!h) throw new Error("deploy submit failed after retries");
  await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
  const tx = await client.getTransaction({ hash: h });
  const addr = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
  if (!addr || tx?.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error("deploy failed: " + tx?.txExecutionResultName);
  return addr;
}
async function call(addr, fn, args) {
  let h = null;
  for (let attempt = 1; attempt <= 25; attempt++) {
    try { h = await client.writeContract({ address: addr, functionName: fn, args, value: 0 }); break; }
    catch (e) { if (isCollision(e)) { await sleep(20000); continue; } return "REVERTED"; }
  }
  if (!h) return "SUBMIT_TIMEOUT";
  try { await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 }); }
  catch (e) { return "REVERTED"; }
  for (let i = 0; i < 120; i++) {
    const tx = await client.getTransaction({ hash: h });
    const r = tx?.txExecutionResultName;
    if (r && r !== "NOT_VOTED") return r;
    await sleep(5000);
  }
  return "NOT_VOTED";
}
async function waitLeaves(addr, fromStatus) {
  let s;
  for (let i = 0; i < 220; i++) { s = await read(addr); if (s?.status !== fromStatus) return s; await sleep(5000); }
  return s;
}
async function waitHistory(addr, minLen) {
  let s;
  for (let i = 0; i < 220; i++) { s = await read(addr); if (histLen(s) >= minLen) return s; await sleep(5000); }
  return s;
}

console.log("### TEST 1: harmful content is moderated and not approved ###");
const c1 = await deploy(RULES, HARMFUL);
console.log("contract:", c1);
console.log("moderate:", await call(c1, "moderate", []));
const s1 = await waitLeaves(c1, "pending");
console.log("verdict:", s1?.verdict, "| status:", s1?.status);
(s1?.status === "moderated" && (s1?.verdict === "REMOVE" || s1?.verdict === "FLAG")) ? pass("harmful content flagged/removed") : fail("expected FLAG or REMOVE", JSON.stringify(s1));

console.log("### TEST 2: benign content is approved ###");
const c2 = await deploy(RULES, BENIGN);
console.log("contract:", c2);
console.log("moderate:", await call(c2, "moderate", []));
const s2 = await waitLeaves(c2, "pending");
console.log("verdict:", s2?.verdict, "| status:", s2?.status);
(s2?.status === "moderated" && s2?.verdict === "APPROVE") ? pass("benign content approved") : fail("expected APPROVE", JSON.stringify(s2));

console.log("### TEST 3: cannot moderate twice ###");
const r3 = await call(c1, "moderate", []);
isRevert(r3) ? pass("double moderate reverted") : fail("expected revert on double moderate", r3);

console.log("### TEST 4: cannot set content after moderated ###");
const r4 = await call(c1, "set_content", ["some new content"]);
isRevert(r4) ? pass("late set_content reverted") : fail("expected revert on late set_content", r4);

console.log("### TEST 5: cannot moderate empty content ###");
const c3 = await deploy(RULES, "");
const r5 = await call(c3, "moderate", []);
isRevert(r5) ? pass("moderate with empty content reverted") : fail("expected revert on empty content", r5);

console.log("### TEST 6: appeal re-runs moderation and records history ###");
const a1 = await call(c2, "appeal", ["I think this is fine, please reconsider."]);
const s6 = await waitHistory(c2, 2);
(!isRevert(a1) && s6?.status === "moderated" && histLen(s6) === 2 && ["APPROVE", "FLAG", "REMOVE"].includes(s6?.verdict)) ? pass("appeal processed, history has 2 rounds") : fail("appeal did not process as expected", JSON.stringify({ a1, status: s6?.status, hist: histLen(s6), verdict: s6?.verdict }));

console.log("### TEST 7: appeal with empty note reverts ###");
const r7 = await call(c1, "appeal", ["   "]);
isRevert(r7) ? pass("empty appeal note reverted") : fail("expected revert on empty appeal note", r7);

console.log("### TEST 8: cannot appeal before moderation ###");
const c4 = await deploy(RULES, "Brand new pending content for the appeal-state guard test.");
const r8 = await call(c4, "appeal", ["Trying to appeal too early."]);
isRevert(r8) ? pass("appeal before moderation reverted") : fail("expected revert on early appeal", r8);

console.log("### TEST 9: appeal limit enforced (max 2) ###");
const a2 = await call(c2, "appeal", ["Second appeal, still think it is fine."]);
await waitHistory(c2, 3);
const a3 = await call(c2, "appeal", ["Third appeal should be blocked."]);
(!isRevert(a2) && isRevert(a3)) ? pass("second appeal ok, third appeal capped") : fail("appeal cap not enforced", JSON.stringify({ a2, a3 }));

console.log("### TEST 10: verdict carries confidence, category and review metadata ###");
const m1 = await read(c1);
const conf = Number(m1?.confidence);
const catOk = CATS.includes(String(m1?.category));
const confOk = Number.isFinite(conf) && conf >= 0 && conf <= 100 && String(m1?.confidence).length > 0;
const flagsOk = (m1?.escalated === "true" || m1?.escalated === "false") && (m1?.needs_review === "true" || m1?.needs_review === "false");
(confOk && catOk && flagsOk) ? pass("confidence/category/flags present and valid") : fail("metadata missing or invalid", JSON.stringify({ confidence: m1?.confidence, category: m1?.category, escalated: m1?.escalated, needs_review: m1?.needs_review }));

console.log("=====================================");
console.log(failed === 0 ? "ALL TESTS PASSED" : (failed + " TEST(S) FAILED"));
process.exitCode = failed === 0 ? 0 : 1;
