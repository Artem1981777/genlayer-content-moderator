// Diagnostics: payload-size probe for the Bradbury consensus contract.
//
// Background: the flat addTransaction(_sender,_recipient,_validators,
// _maxRotations,_txData,_validUntil) is the only entrypoint the upgraded
// Bradbury consensus accepts (struct variant from genlayer-js ≤2.0.0-rc.1
// reverts — see docs/evidence/v2/deploy-path-matrix.md). Yet the real
// registry_v2 deploy (~50 KB txData) broadcast successfully from CI but never
// got mined, while small txs (counter deploys, plain transfers) mine fine.
// This probe broadcasts dummy AddTransactions of increasing _txData size and
// watches each for mining. A dummy reverts on execution — reverted still
// proves the tx reached a block; "unknown to node"/"in mempool" forever means
// the node silently refuses that size. The ceiling found here is the deploy
// blocker to engineer around (contract minification or chunked deploy).
//
// Run: node --env-file=.env scripts/diagnostics/payload-size-probe.mjs
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { toRlp, toHex, encodeFunctionData } from "viem";
import { CONSENSUS_MAIN } from "../lib/txbuild.mjs";

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY is not set (GitHub secret or .env)");
  process.exit(1);
}
const acct = createAccount(process.env.PRIVATE_KEY);
const c = createClient({ chain: testnetBradbury, account: acct });

function dumpError(label, e) {
  console.log(`  ${label}:`);
  console.log("    name:", e?.name, "| code:", e?.code);
  for (const k of ["message", "shortMessage", "details", "data"]) {
    if (e?.[k]) console.log(`    ${k}:`, String(e[k]).slice(0, 300));
  }
  const cause = e?.cause;
  if (cause) console.log("    cause:", String(cause?.message || cause).slice(0, 300), cause?.code ? `(code ${cause.code})` : "");
  console.log("    stack:", String(e?.stack || "").split("\n").slice(1, 3).join(" | ").slice(0, 200));
}

async function rpc(method, params, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await c.request({ method, params });
    } catch (e) {
      const msg = String(e?.details || e?.shortMessage || e?.message || e);
      const retryable = /ECONNRESET|fetch failed|terminated|connect timeout|timeout|rate limit|capacity/i.test(msg);
      if (!retryable || i === tries) {
        dumpError(`rpc ${method} failed`, e);
        throw e;
      }
      console.log(`  [${method}] transient error, retry ${i}: ${msg.slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const chainId = await rpc("eth_chainId", []);
if (chainId !== "0x107d") {
  console.error(`FATAL: eth_chainId=${chainId}, expected 0x107d (Bradbury)`);
  process.exit(1);
}
console.log("chain: Bradbury 0x107d, deployer:", acct.address);

const V6 = [
  { name: "_sender", type: "address" },
  { name: "_recipient", type: "address" },
  { name: "_numOfInitialValidators", type: "uint256" },
  { name: "_maxRotations", type: "uint256" },
  { name: "_txData", type: "bytes" },
  { name: "_validUntil", type: "uint256" },
];
const ADD_TX_ABI = [{ type: "function", name: "addTransaction", stateMutability: "nonpayable", inputs: V6, outputs: [] }];

const SIZES_KB = [24, 32, 40, 44];
const probes = [];
const nonce0 = await rpc("eth_getTransactionCount", [acct.address, "latest"]);
console.log("nonce before probes:", nonce0);

for (const kb of SIZES_KB) {
  const dummy = new Uint8Array(kb * 1024);
  crypto.getRandomValues(dummy);
  const txData = toRlp([toHex(dummy), "0x", "0x"]);
  const data = encodeFunctionData({
    abi: ADD_TX_ABI,
    functionName: "addTransaction",
    args: [acct.address, "0x0000000000000000000000000000000000000000", 5n, 3n, txData, BigInt(Math.floor(Date.now() / 1000) + 3600)],
  });
  const nonce = await rpc("eth_getTransactionCount", [acct.address, "latest"]);
  const gasPrice = (BigInt(await rpc("eth_gasPrice", [])) * 3n) / 2n + 1n;
  let gas = 2_000_000n;
  try {
    gas = (BigInt(await rpc("eth_estimateGas", [{ from: acct.address, to: CONSENSUS_MAIN, data }])) * 12n) / 10n + 10_000n;
    console.log(`${kb}KB: estimateGas=${gas}`);
  } catch (e) {
    console.log(`${kb}KB: estimateGas failed (continuing with 2M):`);
    dumpError("estimateGas", e);
  }
  const raw = await acct.signTransaction({ to: CONSENSUS_MAIN, data, value: 0n, nonce: BigInt(nonce), gas, gasPrice, type: "legacy", chainId: 4221 });
  try {
    const h = await rpc("eth_sendRawTransaction", [raw]);
    console.log(`${kb}KB broadcast: ${h} (raw tx ${(raw.length - 2) / 2} bytes, nonce ${nonce})`);
    probes.push({ kb, h, t0: Date.now() });
  } catch (e) {
    console.log(`${kb}KB broadcast REJECTED:`);
    dumpError("sendRawTransaction", e);
  }
}

console.log("--- watching probes for 3 minutes ---");
for (let i = 0; i < 36; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  for (const p of probes) {
    if (p.mined) continue;
    const rec = await rpc("eth_getTransactionReceipt", [p.h]).catch(() => null);
    if (rec) {
      p.mined = true;
      p.status = rec.status;
      console.log(`${p.kb}KB MINED after ${Math.round((Date.now() - p.t0) / 1000)}s, status=${rec.status} (0x1=success, 0x0=reverted — either proves mining)`);
    }
  }
  if (probes.every((p) => p.mined)) break;
}
for (const p of probes) {
  if (p.mined) continue;
  const pending = await rpc("eth_getTransactionByHash", [p.h]).catch(() => null);
  console.log(`${p.kb}KB NOT MINED in 3min: ${pending ? (pending.blockNumber ? "still mining" : "in mempool, never picked") : "UNKNOWN TO NODE (rejected after broadcast)"}`);
}
const nonce1 = await rpc("eth_getTransactionCount", [acct.address, "latest"]);
console.log("nonce after probes:", nonce1, "(before:", nonce0 + ")");
