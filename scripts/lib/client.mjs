// Shared client helpers for ContentModerator v2 scripts (genlayer-js).
// Reads go through genlayer-js gen_call. Writes are broadcast through the
// flat AddTransaction path (scripts/lib/sender.mjs): the Bradbury consensus
// contract only accepts addTransaction(_sender,_recipient,_validators,
// _maxRotations,_txData,_validUntil); the struct variant encoded by
// genlayer-js ≤2.0.0-rc.1 reverts on-chain.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { encodeWriteTxData, encodeDeployTxData } from "./txbuild.mjs";
import { broadcastAddTransaction, waitFinality } from "./sender.mjs";
import { TransactionStatus } from "genlayer-js/types";

export const RPC = "https://rpc-bradbury.genlayer.com";
export const EXPLORER = "https://explorer-bradbury.genlayer.com";
export const PAGES = "https://artem1981777.github.io/genlayer-content-moderator";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function accountFrom(key) {
  if (!key) throw new Error("Missing private key in .env (PRIVATE_KEY / AUTHOR_KEY)");
  return createAccount(key);
}

export function clientFor(account) {
  return createClient({ chain: testnetBradbury, account });
}

export async function waitFinal(client, hash, label, maxIters = 90) {
  return waitFinality(client, hash, label, maxIters);
}

export async function write(client, address, fn, args = [], value = 0n, label = null) {
  const name = label || fn;
  const account = client.account;
  if (!account) throw new Error("client has no account — create it via clientFor(accountFrom(key))");
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const txData = encodeWriteTxData(fn, args, {});
      const { genTxId } = await broadcastAddTransaction(client, account, {
        recipient: address, txData,
      });
      if (!genTxId) throw new Error("AddTransaction broadcast but no EVM receipt yet");
      const tx = await waitFinality(client, genTxId, name);
      console.log("  " + name + " tx:", genTxId);
      return { hash: genTxId, tx };
    } catch (e) {
      const msg = e?.message || String(e);
      console.log("  " + name + " attempt " + attempt + ": " + msg.slice(0, 110));
      if (attempt < 8) {
        await sleep(15000);
        continue;
      }
      throw e;
    }
  }
}

export async function read(client, address, fn, args = []) {
  return client.readContract({ address, functionName: fn, args });
}

export async function readJson(client, address, fn, args = []) {
  const raw = await read(client, address, fn, args);
  if (raw === "" || raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Runs fn expecting a UserError revert. Returns the error message, or throws
// when the call unexpectedly succeeded.
export async function expectRevert(client, address, fn, args = [], value = 0n, needle = null) {
  try {
    await write(client, address, fn, args, value, fn + " [expect revert]");
  } catch (e) {
    const msg = e?.message || String(e);
    if (needle && !msg.includes(needle)) {
      throw new Error("revert message mismatch: expected needle '" + needle + "' in: " + msg.slice(0, 200));
    }
    return msg;
  }
  throw new Error("expected revert for " + fn + " but call succeeded");
}

export async function balance(client, address) {
  try {
    const b = await client.getBalance({ address });
    return BigInt(b);
  } catch (e) {
    // fall back to raw RPC
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
    });
    const j = await r.json();
    return BigInt(j.result ?? "0x0");
  }
}

export async function sendValue(client, to, value) {
  const hash = await client.sendTransaction({ to, value });
  await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 400 });
  await waitFinal(client, hash, "sendValue");
  return hash;
}

export function txLink(hash) {
  return EXPLORER + "/tx/" + String(hash);
}
