// Low-level GenLayer transaction sender for the Bradbury consensus contract.
//
// The chain only accepts the flat addTransaction entrypoint; genlayer-js
// releases (≤2.0.0-rc.1) encode the legacy struct variant, which reverts
// silently (verified via eth_call 2026-09-13). This module signs the flat
// V6 AddTransaction locally and broadcasts eth_sendRawTransaction — the same
// encoding the official genlayer CLI 0.39.x uses (primary V6, V5 fallback).
import { parseTransaction, parseEventLogs, toHex } from "viem";
import { encodeAddTransactionV6, encodeAddTransactionV5, CONSENSUS_MAIN } from "./txbuild.mjs";
import { sleep } from "./client.mjs";

const CREATED_TX_EVENT = [{
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
    { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" },
  ],
  name: "CreatedTransaction",
  type: "event",
}];
const NEW_TX_EVENT = [{
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
    { indexed: true, internalType: "address", name: "recipient", type: "address" },
    { indexed: true, internalType: "address", name: "activator", type: "address" },
  ],
  name: "NewTransaction",
  type: "event",
}];

export function rawRpc(client) {
  return async (method, params, tries = 6) => {
    let lastErr = null;
    for (let i = 1; i <= tries; i++) {
      lastErr = null;
      try {
        return await client.request({ method, params });
      } catch (e) {
        lastErr = e;
        const msg = String(e?.details || e?.message || e);
        if (!/ECONNRESET|fetch failed|terminated|rate limit|capacity|timeout/i.test(msg)) throw e;
        await sleep(2500 * i);
      }
    }
    throw lastErr;
  };
}

function extractTxId(logs) {
  for (const [abi, name] of [[NEW_TX_EVENT, "NewTransaction"], [CREATED_TX_EVENT, "CreatedTransaction"]]) {
    try {
      const evs = parseEventLogs({ abi, eventName: name, logs });
      if (evs.length > 0) return evs[0].args.txId;
    } catch { /* try next */ }
  }
  return null;
}

// Broadcasts a flat AddTransaction and resolves the GenLayer tx id.
// Retries nonce conflicts locally (rejected pre-broadcast — no double-send);
// never retries after an accepted broadcast: caller decides (nonce check).
export async function broadcastAddTransaction(client, account, { recipient, txData, validators = 5n, maxRotations = 3n, validUntilSec }) {
  const rpc = rawRpc(client);
  const gasPriceHex = await rpc("eth_gasPrice", []);
  const gasPrice = (BigInt(gasPriceHex) * 3n) / 2n + 1n;
  const validUntil = validUntilSec ?? Math.floor(Date.now() / 1000) + 7200;

  const attempt = async (useV6) => {
    const data = useV6
      ? encodeAddTransactionV6({ sender: account.address, recipient, txData, validators, maxRotations, validUntil })
      : encodeAddTransactionV5({ sender: account.address, recipient, txData, validators, maxRotations });
    let gas = 2_000_000n;
    try {
      const est = await rpc("eth_estimateGas", [{ from: account.address, to: CONSENSUS_MAIN, data }]);
      gas = (BigInt(est) * 12n) / 10n + 10_000n;
    } catch (e) {
      console.log("  gas estimation failed, using default 2M:", String(e?.details || e?.message).slice(0, 90));
    }
    // nonce conflicts happen when earlier queued txs are still mining;
    // a conflicted tx is rejected by the node, so re-signing is safe
    let nonce = null;
    for (let i = 0; i < 5; i++) {
      nonce = BigInt(await rpc("eth_getTransactionCount", [account.address, "latest"]));
      try {
        const raw = await account.signTransaction({ to: CONSENSUS_MAIN, data, value: 0n, nonce, gas, gasPrice, type: "legacy", chainId: 4221 });
        const evmHash = await rpc("eth_sendRawTransaction", [raw]);
        return { evmHash, nonce };
      } catch (e) {
        const msg = String(e?.details || e?.message || e);
        if (!/nonce is not consistent|nonce too|replacement transaction|already known/i.test(msg)) throw e;
        console.log("  nonce conflict (" + msg.slice(-70) + "), re-reading nonce");
        await sleep(2000);
      }
    }
    throw new Error("nonce conflict persisted after 5 attempts");
  };

  const mineReceipt = async (evmHash) => {
    for (let i = 0; i < 180; i++) {
      await sleep(5000);
      const receipt = await rpc("eth_getTransactionReceipt", [evmHash]).catch(() => null);
      if (receipt) return receipt;
      if (i > 0 && i % 12 === 0) {
        const pending = await rpc("eth_getTransactionByHash", [evmHash]).catch(() => null);
        console.log(`  evm ${evmHash.slice(0, 14)}…: ${pending ? (pending.blockNumber ? "mining" : "in mempool") : "unknown to node"} (${i * 5}s)`);
      }
    }
    return null;
  };

  let out;
  try {
    const { evmHash } = await attempt(true);
    const receipt = await mineReceipt(evmHash);
    if (!receipt) return { evmHash, genTxId: null, pending: true };
    if (String(receipt.status) !== "0x1") {
      throw new Error(`AddTransaction EVM tx reverted: ${evmHash}`);
    }
    out = { evmHash, genTxId: extractTxId(receipt.logs || []), pending: false };
  } catch (e) {
    const msg = String(e?.details || e?.message || e);
    // V5 fallback only makes sense before anything was broadcast; an EVM revert
    // already proves V6 was processed, so only non-revert transport errors retry.
    if (/reverted/i.test(msg)) throw e;
    console.log("  V6 attempt failed (" + msg.slice(0, 90) + "), trying V5 fallback");
    const { evmHash } = await attempt(false);
    const receipt = await mineReceipt(evmHash);
    if (!receipt) return { evmHash, genTxId: null, pending: true };
    if (String(receipt.status) !== "0x1") {
      throw new Error(`AddTransaction EVM tx reverted (V5): ${evmHash}`);
    }
    out = { evmHash, genTxId: extractTxId(receipt.logs || []), pending: false };
  }
  return out;
}

// Polls a GenLayer tx to finality. Returns the final getTransaction object.
export async function waitFinality(client, genTxId, label, maxIters = 100) {
  for (let i = 0; i < maxIters; i++) {
    let tx = null;
    try {
      tx = await client.getTransaction({ hash: genTxId });
    } catch { /* node flake */ }
    const rn = String(tx?.txExecutionResultName || "");
    const sn = String(tx?.statusName || "");
    if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") return tx;
    if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN|CANCELED/i.test(rn)) {
      let detail = "";
      try {
        const d = tx?.data ?? tx?.txDataDecoded;
        if (d) detail = " " + JSON.stringify(d).slice(0, 300);
      } catch { /* ignore */ }
      throw new Error(`exec failed ${label}: ${rn}${detail}`);
    }
    if (sn === "CANCELED") throw new Error(`canceled ${label}`);
    if (i % 5 === 0) console.log(`  ${label}: consensus... (${rn || sn || "pending"})`);
    await sleep(6000);
  }
  throw new Error(`timeout waiting for finality ${label}`);
}
