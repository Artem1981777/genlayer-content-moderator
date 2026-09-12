// Shared client helpers for ContentModerator v2 scripts (genlayer-js).
// Every write waits for ACCEPTED receipt, then polls execution finality.
// Retries only transient RPC errors BEFORE broadcast (no double-send):
// a failed writeContract may or may not have broadcast, so retries go through
// the consensus-error filter that only matches pre-broadcast failures.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
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

function retriable(msg) {
  msg = String(msg || "").toLowerCase();
  return (
    msg.includes("-32005") ||
    msg.includes("capacity") ||
    msg.includes("rate limit") ||
    msg.includes("exceeds defined limit") ||
    msg.includes("consensus contract") ||
    msg.includes("evm tx") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("not_voted")
  );
}

export async function waitFinal(client, hash, label, maxIters = 90) {
  for (let i = 0; i < maxIters; i++) {
    let tx = null;
    try {
      tx = await client.getTransaction({ hash });
    } catch (e) {
      await sleep(5000);
      continue;
    }
    const rn = String(tx?.txExecutionResultName || "");
    if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") return tx;
    if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) {
      throw new Error("exec failed " + label + ": " + rn);
    }
    if (i % 5 === 0) console.log("  waiting finality " + label + " (" + (rn || "pending") + ")");
    await sleep(6000);
  }
  throw new Error("timeout finality " + label);
}

export async function write(client, address, fn, args = [], value = 0n, label = null) {
  const name = label || fn;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const hash = await client.writeContract({ address, functionName: fn, args, value });
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 400 });
      const tx = await waitFinal(client, hash, name);
      console.log("  " + name + " tx:", hash);
      return { hash, tx };
    } catch (e) {
      const msg = e?.message || String(e);
      console.log("  " + name + " attempt " + attempt + ": " + msg.slice(0, 110));
      if (retriable(msg) && attempt < 8) {
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
