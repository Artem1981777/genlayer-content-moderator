import { readFileSync, writeFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
const operator = createAccount(process.env.PRIVATE_KEY);
const authorKey = readFileSync(process.env.HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim();
const author = createAccount(authorKey);
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });
const SCAM_URL = "https://artem1981777.github.io/genlayer-content-moderator/fixtures/scam.html";
const RULES = "No scams, fraud, or financial schemes. No requests for private keys, wallet seed phrases, or credentials. No spam, no harassment, no hate speech, no violence. Posts must not attempt to deceive or steal from other members.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function retriable(msg) { msg = String(msg || "").toLowerCase(); return msg.includes("-32005") || msg.includes("capacity") || msg.includes("rate limit") || msg.includes("exceeds defined limit") || msg.includes("consensus contract") || msg.includes("evm tx"); }
async function waitFinal(client, hash, label) {
  for (let i = 0; i < 100; i++) {
    let tx = null;
    try { tx = await client.getTransaction({ hash }); } catch (e) { await sleep(5000); continue; }
    const rn = String(tx?.txExecutionResultName || "");
    if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") return tx;
    if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) throw new Error("execution failed for " + label + ": " + rn);
    if (i % 5 === 0) console.log("  ...waiting finality for " + label + " (" + (rn || "pending") + ")");
    await sleep(6000);
  }
  throw new Error("timeout waiting finality for " + label);
}
async function submitWrite(client, address, functionName, args, value) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const hash = await client.writeContract({ address, functionName, args, value: value || 0n });
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 300 });
      await waitFinal(client, hash, functionName);
      return hash;
    } catch (e) {
      const msg = e?.message || String(e);
      if (retriable(msg) && attempt < 40) { console.log("  retry " + functionName + " (" + attempt + "): " + msg.slice(0, 80)); await sleep(8000); continue; }
      throw e;
    }
  }
}
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
async function main() {
  console.log("operator:", operator.address);
  console.log("author:", author.address);
  if (operator.address.toLowerCase() === author.address.toLowerCase()) throw new Error("operator and author must be different accounts");
  console.log("ROLES DISTINCT: true");
  await ensureGas(10000000000000000n, 30000000000000000n);
  const code = new TextEncoder().encode(readFileSync("contracts/moderator.py", "utf8"));
  console.log("deploying ContentModerator v0.5.0 ...");
  let dHash;
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      dHash = await cOp.deployContract({ code, args: [RULES] });
      await cOp.waitForTransactionReceipt({ hash: dHash, status: TransactionStatus.ACCEPTED, retries: 300 });
      break;
    } catch (e) {
      const msg = e?.message || String(e);
      if (retriable(msg) && attempt < 40) { console.log('  retry deploy (' + attempt + '): ' + msg.slice(0, 80)); await sleep(8000); continue; }
      throw e;
    }
  }
  const dtx = await cOp.getTransaction({ hash: dHash });
  const ADDRESS = dtx?.txDataDecoded?.contractAddress ?? dtx?.recipient;
  writeFileSync("cm-contract.txt", String(ADDRESS));
  writeFileSync("cm-deploy-tx.txt", String(dHash));
  console.log("deploy tx:", dHash);
  console.log("contract:", ADDRESS);
  const readState = async () => await cOp.readContract({ address: ADDRESS, functionName: "get_state", args: [] });
  let st = await readState();
  console.log("status after deploy:", st.status, "| creator:", st.creator);
  console.log("author ingesting live source:", SCAM_URL);
  const hIng = await submitWrite(cAuthor, ADDRESS, "ingest", [SCAM_URL], 0n);
  writeFileSync("cm-ingest-tx.txt", String(hIng)); console.log("ingest ->", hIng);
  st = await readState();
  const recorded = String(st.content || "");
  console.log("=== AFTER INGEST ===");
  console.log("author on record:", st.author);
  console.log("item_id:", st.item_id, "| source:", st.source, "| status:", st.status);
  console.log("recorded content (first 200):", recorded.slice(0, 200));
  console.log("content_hash:", st.content_hash);
  const hMod = await submitWrite(cOp, ADDRESS, "moderate", [], 0n);
  writeFileSync("cm-moderate-tx.txt", String(hMod)); console.log("moderate ->", hMod);
  st = await readState();
  console.log("=== VERDICT ===");
  console.log("verdict:", st.verdict, "| category:", st.category, "| confidence:", st.confidence);
  console.log("reason:", st.reason);
  const hEnf = await submitWrite(cOp, ADDRESS, "enforce", [], 0n);
  writeFileSync("cm-enforce-tx.txt", String(hEnf)); console.log("enforce ->", hEnf);
  const shown = await cOp.readContract({ address: ADDRESS, functionName: "read_content", args: [] });
  st = await readState();
  console.log("=== ENFORCEMENT ===");
  console.log("enforcement_action:", st.enforcement_action, "| blocked:", st.blocked, "| limited:", st.limited);
  console.log("read_content ->", shown);
  const okReal = await cOp.readContract({ address: ADDRESS, functionName: "verify_content", args: [recorded] });
  const okFake = await cOp.readContract({ address: ADDRESS, functionName: "verify_content", args: ["totally different tampered text"] });
  console.log("=== VERIFY_CONTENT ===");
  console.log("verify_content(recorded):", okReal, "(expect true)");
  console.log("verify_content(tampered):", okFake, "(expect false)");
  const hApp = await submitWrite(cAuthor, ADDRESS, "appeal", ["I am the author; this was a legitimate promo, please re-review."], 0n);
  writeFileSync("cm-appeal-tx.txt", String(hApp)); console.log("appeal ->", hApp);
  st = await readState(); console.log("status after appeal:", st.status);
  const hRes = await submitWrite(cOp, ADDRESS, "resolve_appeal", [], 0n);
  writeFileSync("cm-resolve-tx.txt", String(hRes)); console.log("resolve_appeal ->", hRes);
  st = await readState();
  console.log("=== APPEAL RESULT ===");
  console.log("appeal_outcome:", st.appeal_outcome, "| verdict:", st.verdict, "| status:", st.status);
  const hRev = await submitWrite(cOp, ADDRESS, "reverify_source", [], 0n);
  writeFileSync("cm-reverify-tx.txt", String(hRev)); console.log("reverify_source ->", hRev);
  st = await readState();
  let revMatch = "";
  try { const items = JSON.parse(st.history || "[]"); for (const it of items) { if (it && it.kind === "reverify") revMatch = String(it.note || ""); } } catch (e) {}
  console.log("=== REVERIFY SOURCE ===");
  console.log("reverify result (from history):", revMatch, "(expect match=true)");
  console.log("=== CM RUN SUMMARY ===");
  console.log("contract:", ADDRESS);
  console.log("operator:", operator.address, "| author:", author.address);
  console.log("deploy:", dHash);
  console.log("ingest:", hIng);
  console.log("moderate:", hMod);
  console.log("enforce:", hEnf);
  console.log("appeal:", hApp);
  console.log("resolve_appeal:", hRes);
  console.log("reverify_source:", hRev);
  console.log(">>> CM RUN COMPLETE");
}
main().catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });
