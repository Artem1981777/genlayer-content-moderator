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

console.log("=== 1) READ STATE (before) ===");
const before = await client.readContract({ address: CONTRACT, functionName: "get_state", args: [] });
console.log(before);
console.log("=== 2) MODERATE (AI + validator consensus) ===");
const h = await client.writeContract({ address: CONTRACT, functionName: "moderate", args: [], value: 0 });
console.log("moderate tx:", h);
await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });

let resultName = "NOT_VOTED";
for (let i = 0; i < 100; i++) {
  const tx = await client.getTransaction({ hash: h });
  const r = tx?.txExecutionResultName;
  if (r && r !== "NOT_VOTED") { resultName = r; break; }
  await sleep(3000);
}
console.log("moderate execution result:", resultName);
console.log("=== 3) READ STATE (after) ===");
let after = before;
for (let i = 0; i < 100; i++) {
  after = await client.readContract({ address: CONTRACT, functionName: "get_state", args: [] });
  if (after?.status !== "pending") break;
  await sleep(3000);
}
console.log(after);
console.log("=====================================");
console.log("VERDICT:", after?.verdict, "| STATUS:", after?.status);
console.log("REASON:", after?.reason);
console.log("moderate tx:", h);
console.log("=====================================");
writeFileSync("moderate-tx.txt", String(h));
