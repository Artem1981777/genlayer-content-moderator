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
const SCAM_URL = HOST + DIR + "scam.html";
const BENIGN_URL = HOST + DIR + "benign.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam, no harassment, no hate speech, no violence.";
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const APPEAL_BOND = 2000000000000n;
const POOL_FUND = 5000000000000n;
const txs = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function retriable(msg) { msg = String(msg || "").toLowerCase(); return msg.includes("-32005") || msg.includes("capacity") || msg.includes("rate limit") || msg.includes("exceeds defined limit") || msg.includes("consensus contract") || msg.includes("evm tx"); }
async function waitFinal(client, hash, label, maxIters) {
  for (let i = 0; i < (maxIters || 60); i++) {
    let tx = null;
    try { tx = await client.getTransaction({ hash }); } catch (e) { await sleep(5000); continue; }
    const rn = String(tx?.txExecutionResultName || "");
    if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") return tx;
    if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("exec failed " + label + ": " + rn);
    if (i % 5 === 0) console.log("  waiting finality " + label + " (" + (rn || "pending") + ")");
    await sleep(6000);
  }
  throw new Error("timeout finality " + label);
}
async function w(client, fn, args, value) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const hash = await client.writeContract({ address: ADDRESS, functionName: fn, args: args || [], value: value || 0n });
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 400 });
      await waitFinal(client, hash, fn, 60);
      console.log("  " + fn + " tx:", hash);
      return hash;
    } catch (e) {
      const msg = e?.message || String(e);
      console.log("  " + fn + " attempt " + attempt + ": " + msg.slice(0, 90));
      if ((retriable(msg) || /timeout|not_voted|fetch failed|finished_with_error/i.test(msg)) && attempt < 8) { await sleep(12000); continue; }
      throw e;
    }
  }
}
async function readJson(client, fn, args) {
  const raw = await client.readContract({ address: ADDRESS, functionName: fn, args: args || [] });
  if (typeof raw === "string") { if (raw === "") return null; try { return JSON.parse(raw); } catch (e) { return raw; } }
  return raw;
}
async function newestId() { const ids = await readJson(cOp, "get_item_ids", []); return Array.isArray(ids) ? ids[ids.length - 1] : null; }
async function ensureGas(minWei, topupWei) {
  const b = await cOp.getBalance({ address: author.address });
  console.log("author balance:", b.toString());
  if (b < minWei) {
    console.log("topping up author ...");
    let h;
    try { h = await cOp.sendTransaction({ to: author.address, value: topupWei }); }
    catch (e) { h = await cOp.sendTransaction({ account: operator, to: author.address, value: topupWei }); }
    console.log("topup tx:", h);
    for (let i = 0; i < 25; i++) { const nb = await cOp.getBalance({ address: author.address }); if (nb >= minWei) { console.log("author funded:", nb.toString()); break; } await sleep(6000); }
  }
}
async function runItem(label, ingestClient, url, reportClient) {
  console.log("===== ITEM: " + label + " =====");
  txs[label + "_create"] = await w(cOp, "create_item", [RULES], 0n);
  const id = await newestId();
  console.log("  item_id:", id);
  txs[label + "_ingest"] = await w(ingestClient, "ingest", [id, url], MIN_STAKE);
  let it = await readJson(cOp, "get_item", [id]);
  console.log("  after ingest: status", it.status, "| author", it.author, "| hash", it.content_hash);
  if (reportClient) { txs[label + "_report"] = await w(reportClient, "report", [id], REPORT_BOND); console.log("  reporter:", (await readJson(cOp, "get_item", [id])).reporter); }
  txs[label + "_moderate"] = await w(cOp, "moderate", [id], 0n);
  it = await readJson(cOp, "get_item", [id]);
  console.log("  VERDICT:", it.verdict, "| category:", it.category, "| conf:", it.confidence, "| severity:", it.severity);
  console.log("  injection:", it.injection_detected, "| escalated:", it.escalated, "| axes:", JSON.stringify(it.axis_scores));
  txs[label + "_enforce"] = await w(cOp, "enforce", [id], 0n);
  it = await readJson(cOp, "get_item", [id]);
  console.log("  ENFORCED action:", it.enforcement_action, "| blocked:", it.blocked, "| stake_outcome:", it.stake_outcome);
  return id;
}
async function main() {
  console.log("registry:", ADDRESS);
  console.log("operator/owner:", operator.address);
  console.log("author:", author.address);
  if (operator.address.toLowerCase() === author.address.toLowerCase()) throw new Error("operator and author must differ");
  await ensureGas(10000000000000000n, 30000000000000000n);
  console.log("config before:", JSON.stringify(await readJson(cOp, "get_config", [])));
  txs.fund = await w(cOp, "fund_pool", [], POOL_FUND);
  console.log("pool funded:", (await readJson(cOp, "get_config", [])).pool);
  const id1 = await runItem("scam", cAuthor, SCAM_URL, cOp);
  let it1 = await readJson(cOp, "get_item", [id1]);
  if (it1.verdict === "REMOVE" || it1.verdict === "FLAG") {
    txs.scam_appeal = await w(cAuthor, "appeal", [id1, "Author here: legitimate promo, please re-review."], APPEAL_BOND);
    txs.scam_resolve = await w(cOp, "resolve_appeal", [id1], 0n);
    it1 = await readJson(cOp, "get_item", [id1]);
    console.log("  APPEAL outcome:", it1.appeal_outcome, "| verdict:", it1.verdict, "| stake_outcome:", it1.stake_outcome);
  } else { console.log("  (skip appeal: verdict APPROVE)"); }
  const id2 = await runItem("benign", cAuthor, BENIGN_URL, cOp);
  console.log("===== REGISTRY PROOFS =====");
  const all = await readJson(cOp, "get_all_items", [0, 10]);
  console.log("total items:", all.total);
  for (const it of all.items) { console.log("  item", it.id, "|", it.status, "| verdict", it.verdict, "| stake_outcome", it.stake_outcome); }
  const payouts = await readJson(cOp, "get_payouts", []);
  console.log("PAYOUT LEDGER entries:", payouts.length);
  for (const p of payouts) { console.log("  pay", p.amount, "to", p.to, "reason", p.reason); }
  console.log("config after:", JSON.stringify(await readJson(cOp, "get_config", [])));
  writeFileSync("registry-e2e.json", JSON.stringify({ address: ADDRESS, txs, items: all, payouts }, null, 2));
  console.log("=== TX HASHES ===");
  for (const k of Object.keys(txs)) { console.log(k + ":", txs[k]); }
  console.log("=== E2E COMPLETE ===");
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });
