import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = process.env.HOME;
const ADDRESS = readFileSync("cm-contract.txt", "utf8").trim();
const SCAM_URL = "https://artem1981777.github.io/genlayer-content-moderator/fixtures/scam.html";
const operator = createAccount(process.env.PRIVATE_KEY);
const author = createAccount(readFileSync(HOME + "/genlayer/escrow-dapp/seller-key.txt", "utf8").trim());
const cOp = createClient({ chain: testnetBradbury, account: operator });
const cAuthor = createClient({ chain: testnetBradbury, account: author });
function retriable(m) {
  m = String(m || "");
  return /-32005|capacity|rate limit|exceeds defined limit|consensus contract|evm tx|NOT_VOTED|timeout/i.test(m);
}
async function getState() {
  for (let a = 1; a <= 40; a++) {
    try {
      return await cOp.readContract({ address: ADDRESS, functionName: "get_state", args: [] });
    } catch (e) {
      const msg = e?.message || String(e);
      if (retriable(msg) && a < 40) { await sleep(6000); continue; }
      throw e;
    }
  }
}
async function submitWrite(client, functionName, args = []) {
  for (let a = 1; a <= 60; a++) {
    try {
      const h = await client.writeContract({ address: ADDRESS, functionName, args });
      await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
      return h;
    } catch (e) {
      const msg = e?.message || String(e);
      if (retriable(msg) && a < 60) { console.log("  retry " + functionName + " (" + a + "): " + msg.slice(0, 80)); await sleep(8000); continue; }
      throw e;
    }
  }
}
async function waitStatus(want, label, maxMin = 45) {
  const wants = Array.isArray(want) ? want : [want];
  const deadline = Date.now() + maxMin * 60 * 1000;
  while (Date.now() < deadline) {
    const st = await getState();
    if (wants.includes(st.status)) return st;
    console.log("  ...waiting " + label + ": status=" + st.status);
    await sleep(6000);
  }
  throw new Error("timeout waiting " + label);
}
async function main() {
  console.log("resume contract:", ADDRESS);
  console.log("operator:", operator.address, "| author:", author.address);
  let recorded = existsSync("cm-recorded.txt") ? readFileSync("cm-recorded.txt", "utf8") : "";
  let st = await getState();
  console.log("current status:", st.status);
  if (st.status === "created") {
    const grace = Date.now() + 6 * 60 * 1000;
    while (Date.now() < grace) {
      st = await getState();
      if (st.status !== "created") break;
      console.log("  ...status still created, waiting for prior ingest to finalize");
      await sleep(6000);
    }
  }
  if (st.status === "created") {
    console.log("ingest (author) ...");
    const h = await submitWrite(cAuthor, "ingest", [SCAM_URL]);
    writeFileSync("cm-ingest-tx.txt", h);
    console.log("ingest tx:", h);
    st = await waitStatus("pending", "ingest -> pending");
  }
  if (st.status === "pending" || st.status === "moderated") {
    const c = await cOp.readContract({ address: ADDRESS, functionName: "read_content", args: [] });
    if (c && !String(c).includes("REMOVED BY CONSENSUS")) { recorded = String(c); writeFileSync("cm-recorded.txt", recorded); }
  }
  if (st.status === "pending") {
    console.log("moderate (operator) ...");
    const h = await submitWrite(cOp, "moderate", []);
    writeFileSync("cm-moderate-tx.txt", h);
    console.log("moderate tx:", h);
    st = await waitStatus("moderated", "moderate -> moderated");
  }
  console.log("verdict:", st.verdict, "| category:", st.category, "| reason:", st.reason);
  if (st.status === "moderated") {
    if (!recorded) {
      const c = await cOp.readContract({ address: ADDRESS, functionName: "read_content", args: [] });
      if (c && !String(c).includes("REMOVED BY CONSENSUS")) { recorded = String(c); writeFileSync("cm-recorded.txt", recorded); }
    }
    console.log("enforce (operator) ...");
    const h = await submitWrite(cOp, "enforce", []);
    writeFileSync("cm-enforce-tx.txt", h);
    console.log("enforce tx:", h);
    st = await waitStatus("enforced", "enforce -> enforced");
  }
  console.log("read_content ->", await cOp.readContract({ address: ADDRESS, functionName: "read_content", args: [] }));
  if (st.status === "enforced") {
    console.log("appeal (author) ...");
    const h = await submitWrite(cAuthor, "appeal", ["Requesting appeal review of the consensus REMOVE verdict."]);
    writeFileSync("cm-appeal-tx.txt", h);
    console.log("appeal tx:", h);
    st = await waitStatus("appealed", "appeal -> appealed");
  }
  if (st.status === "appealed") {
    console.log("resolve_appeal (operator) ...");
    const h = await submitWrite(cOp, "resolve_appeal", []);
    writeFileSync("cm-resolve-tx.txt", h);
    console.log("resolve_appeal tx:", h);
    st = await waitStatus("resolved", "resolve -> resolved");
  }
  console.log("appeal_outcome:", st.appeal_outcome);
  return { st, recorded };
}
async function finish(ctx) {
  const recorded = ctx.recorded;
  console.log("reverify_source (operator) ...");
  const rh = await submitWrite(cOp, "reverify_source", []);
  writeFileSync("cm-reverify-tx.txt", rh);
  console.log("reverify tx:", rh);
  let match = null;
  for (let a = 1; a <= 40; a++) {
    const s = await getState();
    const hist = String(s.history || "").toLowerCase();
    const m = hist.lastIndexOf("reverify");
    if (m >= 0) {
      const tail = hist.slice(m, m + 140);
      if (tail.includes("match=true") || tail.includes("match\": true") || tail.includes("match=yes")) { match = true; break; }
      if (tail.includes("match=false") || tail.includes("match\": false") || tail.includes("match=no")) { match = false; break; }
    }
    await sleep(6000);
  }
  console.log("reverify match:", match);
  let vTrue = null, vFalse = null;
  if (recorded) {
    vTrue = await cOp.readContract({ address: ADDRESS, functionName: "verify_content", args: [recorded] });
    vFalse = await cOp.readContract({ address: ADDRESS, functionName: "verify_content", args: [recorded + " TAMPERED"] });
  }
  const fin = await getState();
  console.log("");
  console.log("=== CM RUN SUMMARY (v0.5.0) ===");
  console.log("contract:", ADDRESS);
  console.log("author on record:", fin.author);
  console.log("item_id:", fin.item_id, "| source:", fin.source);
  console.log("content_hash:", fin.content_hash);
  console.log("status:", fin.status, "| verdict:", fin.verdict, "| category:", fin.category);
  console.log("appeal_outcome:", fin.appeal_outcome);
  console.log("read_content:", await cOp.readContract({ address: ADDRESS, functionName: "read_content", args: [] }));
  console.log("verify_content(recorded):", vTrue, "| verify_content(tampered):", vFalse);
  console.log("reverify match:", match);
  console.log("--- tx hashes ---");
  for (const f of ["cm-contract", "cm-ingest-tx", "cm-moderate-tx", "cm-enforce-tx", "cm-appeal-tx", "cm-resolve-tx", "cm-reverify-tx"]) {
    try { console.log(f + ":", readFileSync(f + ".txt", "utf8").trim()); } catch (e) {}
  }
  console.log(">>> CM RUN COMPLETE");
}
main().then(finish).catch((e) => { console.error("FATAL:", e?.message || e); process.exit(1); });
