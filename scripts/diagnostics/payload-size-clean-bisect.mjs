// Diagnostics: clean payload-size bisect for the Bradbury consensus contract.
//
// Earlier probe runs were contaminated: every dummy with txData >= 24KB shared
// one nonce slot with a previous never-mined broadcast, so the node may have
// silently ignored them as same-nonce duplicates. This probe first frees the
// stuck nonce slot (0-value self-transfer with 3x gas price — the standard
// replacement), then broadcasts each size with a fresh sequential nonce and
// elevated gas price, watching every probe for mining.
//
// Run: node --env-file=.env scripts/diagnostics/payload-size-clean-bisect.mjs
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
  console.log(`  [${label}]`);
  for (const k of ["message", "shortMessage", "details", "data"]) {
    if (e?.[k]) console.log(`    ${k}:`, String(e[k]).slice(0, 300));
  }
  const cause = e?.cause;
  if (cause) console.log("    cause:", String(cause?.message || cause).slice(0, 300));
}

async function rpc(method, params, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await c.request({ method, params });
    } catch (e) {
      const msg = String(e?.details || e?.shortMessage || e?.message || e);
      if (!/ECONNRESET|fetch failed|terminated|connect timeout|timeout|rate limit|capacity/i.test(msg)) {
        dumpError(`rpc ${method}`, e);
        throw e;
      }
      console.log(`  [${method}] transient: ${msg.slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const chainId = await rpc("eth_chainId", []);
if (chainId !== "0x107d") {
  console.error(`FATAL: eth_chainId=${chainId}, expected 0x107d`);
  process.exit(1);
}
console.log("chain OK, deployer:", acct.address);

let nonce = BigInt(await rpc("eth_getTransactionCount", [acct.address, "latest"]));
const baseGasPrice = BigInt(await rpc("eth_gasPrice", []));
console.log("nonce start:", nonce, "| gasPrice:", baseGasPrice);

async function mineReceipt(hash, maxSec = 240) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    await new Promise((r) => setTimeout(r, 5000));
    const rec = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (rec) return rec;
  }
  return null;
}

// Step 1: free any stuck nonce slot with a replacement self-transfer.
const cancelPrice = baseGasPrice * 3n;
const cancelRaw = await acct.signTransaction({ to: acct.address, value: 0n, nonce, gas: 21000n, gasPrice: cancelPrice, type: "legacy", chainId: 4221 });
const cancelHash = await rpc("eth_sendRawTransaction", [cancelRaw]);
console.log(`cancel tx for nonce ${nonce}: ${cancelHash}`);
const cancelRec = await mineReceipt(cancelHash, 120);
if (cancelRec) {
  console.log("cancel MINED, status=" + cancelRec.status + " — nonce slot freed");
  nonce += 1n;
} else {
  console.log("cancel not mined in 2 min — mempool may be clean already; continuing");
}

// Step 2: sequential probes with unique nonces.
const V6 = [
  { name: "_sender", type: "address" },
  { name: "_recipient", type: "address" },
  { name: "_numOfInitialValidators", type: "uint256" },
  { name: "_maxRotations", type: "uint256" },
  { name: "_txData", type: "bytes" },
  { name: "_validUntil", type: "uint256" },
];
const ADD_TX_ABI = [{ type: "function", name: "addTransaction", stateMutability: "nonpayable", inputs: V6, outputs: [] }];
const SIZES_KB = [18, 20, 24, 28, 36, 44];
const probes = [];

for (const kb of SIZES_KB) {
  const dummy = new Uint8Array(kb * 1024);
  crypto.getRandomValues(dummy);
  const txData = toRlp([toHex(dummy), "0x", "0x"]);
  const data = encodeFunctionData({
    abi: ADD_TX_ABI,
    functionName: "addTransaction",
    args: [acct.address, "0x0000000000000000000000000000000000000000", 5n, 3n, txData, BigInt(Math.floor(Date.now() / 1000) + 3600)],
  });
  const gasPrice = (BigInt(await rpc("eth_gasPrice", [])) * 2n) + 1n;
  const raw = await acct.signTransaction({ to: CONSENSUS_MAIN, data, value: 0n, nonce, gas: 60_000_000n, gasPrice, type: "legacy", chainId: 4221 });
  try {
    const h = await rpc("eth_sendRawTransaction", [raw]);
    console.log(`${kb}KB broadcast: ${h} (raw ${(raw.length - 2) / 2} bytes, nonce ${nonce})`);
    probes.push({ kb, h, n: nonce, t0: Date.now() });
  } catch (e) {
    console.log(`${kb}KB broadcast REJECTED at nonce ${nonce}:`);
    dumpError("sendRawTransaction", e);
  }
  nonce += 1n; // sequential unique nonces regardless of outcome
}

console.log("--- watching probes for 4 minutes ---");
const deadline = Date.now() + 240 * 1000;
while (Date.now() < deadline && probes.some((p) => !p.mined && !p.rejected)) {
  await new Promise((r) => setTimeout(r, 5000));
  for (const p of probes) {
    if (p.mined || p.rejected) continue;
    const rec = await rpc("eth_getTransactionReceipt", [p.h]).catch(() => null);
    if (rec) {
      p.mined = true;
      console.log(`${p.kb}KB (nonce ${p.n}) MINED after ${Math.round((Date.now() - p.t0) / 1000)}s, status=${rec.status}`);
    }
  }
}
for (const p of probes) {
  if (p.mined) continue;
  const pending = await rpc("eth_getTransactionByHash", [p.h]).catch(() => null);
  console.log(`${p.kb}KB (nonce ${p.n}) NOT MINED: ${pending ? (pending.blockNumber ? "still mining" : "in mempool, never picked") : "UNKNOWN TO NODE"}`);
}
console.log("nonce end:", await rpc("eth_getTransactionCount", [acct.address, "latest"]));
