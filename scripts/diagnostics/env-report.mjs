// Diagnostics: environment report for the Bradbury deployer key.
// Prints chain id, block, gas price, deployer balance and nonces so a CI log
// alone is enough to judge whether the environment is sane before broadcasting.
// Run: node scripts/diagnostics/env-report.mjs  (PRIVATE_KEY from env)
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { CONSENSUS_MAIN } from "../lib/config.mjs";

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY is not set (GitHub secret or .env)");
  process.exit(1);
}
const acct = createAccount(process.env.PRIVATE_KEY);
const c = createClient({ chain: testnetBradbury, account: acct });
console.log("deployer:", acct.address);

let failures = 0;
async function rpc(method, params, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await c.request({ method, params });
    } catch (e) {
      const msg = String(e?.details || e?.shortMessage || e?.message || e);
      const retryable = /ECONNRESET|fetch failed|terminated|connect timeout|timeout/i.test(msg);
      console.log(`  [${method}] attempt ${i}: ${msg.slice(0, 160)}`);
      if (!retryable || i === tries) {
        failures++;
        return { __error: msg.slice(0, 200), __details: e?.details, __data: e?.data };
      }
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const chainId = await rpc("eth_chainId", []);
console.log("eth_chainId:", chainId, chainId === "0x107d" ? "(OK, Bradbury)" : "(MISMATCH — expected 0x107d)");
const block = await rpc("eth_blockNumber", []);
console.log("eth_blockNumber:", block);
const blockData = await rpc("eth_getBlockByNumber", ["latest", false]);
console.log("latest block ts:", blockData?.timestamp ? new Date(Number(BigInt(blockData.timestamp)) * 1000).toISOString() : "?");
console.log("eth_gasPrice:", await rpc("eth_gasPrice", []));
const bal = await rpc("eth_getBalance", [acct.address, "latest"]);
console.log("balance GEN:", typeof bal === "string" ? Number(BigInt(bal)) / 1e18 : bal);
const nLatest = await rpc("eth_getTransactionCount", [acct.address, "latest"]);
const nPending = await rpc("eth_getTransactionCount", [acct.address, "pending"]);
console.log("nonce latest:", nLatest, "| nonce pending:", nPending,
  nLatest !== nPending ? `(⚠ ${Number(BigInt(nPending)) - Number(BigInt(nLatest))} tx(s) queued in mempool)` : "(clean)");
// consensus main is alive?
const codeMain = await rpc("eth_getCode", [CONSENSUS_MAIN, "latest"]);
console.log("consensus main code bytes:", typeof codeMain === "string" ? (codeMain.length - 2) / 2 : codeMain);
if (failures > 0) {
  console.log(`\n${failures} RPC call(s) failed — network path is unstable; expect flaky broadcasts.`);
}
