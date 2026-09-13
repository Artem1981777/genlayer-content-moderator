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
const HOST = "https://artem1981777.github.io";
const DIR = "/genlayer-content-moderator/fixtures/";
const BENIGN_URL = HOST + DIR + "benign.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam, no harassment, no hate speech, no violence.";
const MIN_STAKE = 1000000000000n;
const REPORT_BOND = 1000000000000n;
const txs = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function retriable(msg) { msg = String(msg || "").toLowerCase(); return msg.includes("-32005") || msg.includes("capacity") || msg.includes("rate limit") || msg.includes("exceeds defined limit") || msg.includes("consensus contract") || msg.includes("evm tx"); }
async function waitFinal(client, hash) {
  for (let i = 0; i < 60; i++) {
    let tx = null;
    try { tx = await client.getTransaction({ hash }); } catch (e) { await sleep(5000); continue; }
    const rn = String(tx?.txExecutionResultName || "");
    if (rn) { if (rn !== "PENDING" && rn !== "NOT_VOTED" && rn !== "ACTIVATED") return rn; }
    await sleep(6000);
  }
  return "TIMEOUT";
}
async function readJson(client, fn, args) {
  const raw = await client.readContract({ address: ADDRESS, functionName: fn, args: args || [] });
  if (typeof raw === "string") { if (raw === "") return null; try { return JSON.parse(raw); } catch (e) { return raw; } }
  return raw;
}
async function newestId() { const ids = await readJson(cOp, "get_item_ids", []); return Array.isArray(ids) ? ids[ids.length - 1] : null; }
async function wLand(client, fn, args, value, itemId, checkFn) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    let hash = null;
    try {
      hash = await client.writeContract({ address: ADDRESS, functionName: fn, args: args || [], value: value || 0n });
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 400 });
      const rn = await waitFinal(client, hash);
      console.log("  " + fn + " attempt " + attempt + " result " + rn + " tx " + hash);
    } catch (e) {
      console.log("  " + fn + " attempt " + attempt + " submit err " + String(e?.message || e).slice(0, 80));
    }
    if (!checkFn) { if (hash) { txs[fn] = hash; return hash; } }
    else {
      try { const it = await readJson(cOp, "get_item", [itemId]); if (it && checkFn(it)) { if (hash) txs[fn] = hash; console.log("  " + fn + " LANDED"); return hash; } } catch (_) {}
    }
    await sleep(12000);
  }
  throw new Error(fn + " did not land after retries");
}
async function main() {
  console.log("registry:", ADDRESS);
  console.log("author:", author.address);
  const all = await readJson(cOp, "get_all_items", [0, 50]);
  let target = null;
  for (const it of all.items) { if (it.status === "created") { target = it.id; break; } }
  if (!target) { await wLand(cOp, "create_item", [RULES], 0n, null, null); target = await newestId(); }
  console.log("benign target item:", target);
  await wLand(cAuthor, "ingest", [target, BENIGN_URL], MIN_STAKE, target, (it) => it.status === "ingested");
  await wLand(cOp, "report", [target], REPORT_BOND, target, (it) => it.reporter && it.reporter.length > 0);
  await wLand(cOp, "moderate", [target], 0n, target, (it) => it.verdict && String(it.verdict).length > 0);
  let it = await readJson(cOp, "get_item", [target]);
  console.log("VERDICT:", it.verdict, "| category:", it.category, "| conf:", it.confidence, "| axes:", JSON.stringify(it.axis_scores));
  await wLand(cOp, "enforce", [target], 0n, target, (it) => it.status === "enforced");
  it = await readJson(cOp, "get_item", [target]);
  console.log("ENFORCED action:", it.enforcement_action, "| stake_outcome:", it.stake_outcome);
  const all2 = await readJson(cOp, "get_all_items", [0, 50]);
  console.log("total items:", all2.total);
  for (const x of all2.items) { console.log("  item", x.id, "|", x.status, "| verdict", x.verdict, "| stake_outcome", x.stake_outcome); }
  const payouts = await readJson(cOp, "get_payouts", []);
  console.log("PAYOUT LEDGER entries:", payouts.length);
  for (const p of payouts) { console.log("  pay", p.amount, "to", p.to, "reason", p.reason); }
  console.log("config:", JSON.stringify(await readJson(cOp, "get_config", [])));
  console.log("=== BENIGN TX HASHES ===");
  for (const k of Object.keys(txs)) { console.log(k + ":", txs[k]); }
  console.log("=== ITEM2 COMPLETE ===");
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });
