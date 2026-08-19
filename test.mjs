import { readFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const PK = process.env.PRIVATE_KEY;
if (!PK) { throw new Error("PRIVATE_KEY missing. Run: node --env-file=.env test.mjs"); }
const source = readFileSync("contracts/moderator.py", "utf8");
const code = new TextEncoder().encode(source);

const RULES = "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. No hate speech or harassment. No violence or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const HARMFUL = "FREE CRYPTO!! Send 1 ETH to 0xGiveaway and get 10 ETH back instantly! DM me your wallet seed phrase now to claim before it ends!!!";
const BENIGN = "Thanks everyone for the great meetup yesterday - really enjoyed the talks on rollups and consensus. Looking forward to the next one!";

const account = createAccount(PK);
const client = createClient({ chain: testnetBradbury, account });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const pass = (n) => console.log("PASS -", n);
const fail = (n, extra) => { console.log("FAIL -", n, extra ?? ""); failed++; };
const read = (addr) => client.readContract({ address: addr, functionName: "get_state", args: [] });
const isRevert = (r) => (r === "FINISHED_WITH_ERROR" || r === "REVERTED");

async function deploy(rules, content) {
  const h = await client.deployContract({ code, args: [rules, content] });
  await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
  const tx = await client.getTransaction({ hash: h });
  const addr = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
  if (!addr || tx?.txExecutionResultName !== "FINISHED_WITH_RETURN") { throw new Error("deploy failed: " + tx?.txExecutionResultName); }
  return addr;
}
async function call(addr, fn, args) {
  try {
    const h = await client.writeContract({ address: addr, functionName: fn, args, value: 0 });
    await client.waitForTransactionReceipt({ hash: h, status: TransactionStatus.ACCEPTED, retries: 300 });
    let tx;
    for (let i = 0; i < 100; i++) {
      tx = await client.getTransaction({ hash: h });
      const r = tx?.txExecutionResultName;
      if (r && r !== "NOT_VOTED") return r;
      await sleep(3000);
    }
    return tx?.txExecutionResultName ?? "NOT_VOTED";
  } catch (e) {
    return "REVERTED";
  }
}
async function waitLeaves(addr, fromStatus) {
  let s;
  for (let i = 0; i < 100; i++) {
    s = await read(addr);
    if (s?.status !== fromStatus) return s;
    await sleep(3000);
  }
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

console.log("=====================================");
console.log(failed === 0 ? "ALL TESTS PASSED" : (failed + " TEST(S) FAILED"));
process.exitCode = failed === 0 ? 0 : 1;
