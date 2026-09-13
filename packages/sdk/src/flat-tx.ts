// Flat AddTransaction support for the upgraded Bradbury consensus contract.
//
// The consensus main (0x0112Bf…) only exposes the flat
// addTransaction(address,address,uint256,uint256,bytes,uint256) entrypoint;
// the struct variant encoded by genlayer-js ≤ 2.0.0-rc.1 reverts (verified on
// chain via eth_call, see docs/evidence/v2/deploy-path-matrix.md). This ports
// the official genlayer CLI 0.39.x encoding: GenLayer calldata → RLP txData →
// flat addTransaction → locally signed legacy EVM tx → eth_sendRawTransaction.
import {
  encodeFunctionData,
  toRlp,
  toHex,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";

export const CONSENSUS_MAIN: Address = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D";

// --- GenLayer calldata encoder (port of genlayer-js src/abi/calldata, MIT) ---
const BITS_IN_TYPE = 3;
const TYPE_PINT = 1;
const TYPE_NINT = 2;
const TYPE_BYTES = 3;
const TYPE_STR = 4;
const TYPE_ARR = 5;
const TYPE_MAP = 6;
const SPECIAL_NULL = 0 << BITS_IN_TYPE;
const SPECIAL_FALSE = 1 << BITS_IN_TYPE;
const SPECIAL_TRUE = 2 << BITS_IN_TYPE;
const SPECIAL_ADDR = 3 << BITS_IN_TYPE;

function writeNum(to: number[], data: bigint): void {
  if (data === 0n) {
    to.push(0);
    return;
  }
  while (data > 0n) {
    let cur = Number(data & 0x7fn);
    data >>= 7n;
    if (data > 0n) cur |= 128;
    to.push(cur);
  }
}

function encodeNumWithType(to: number[], data: bigint, type: number): void {
  writeNum(to, (data << BigInt(BITS_IN_TYPE)) | BigInt(type));
}

function encodeNum(to: number[], data: bigint): void {
  if (data >= 0n) encodeNumWithType(to, data, TYPE_PINT);
  else encodeNumWithType(to, -data - 1n, TYPE_NINT);
}

function compareString(l: number[], r: number[]): number {
  for (let i = 0; i < l.length && i < r.length; i++) {
    const cur = l[i] - r[i];
    if (cur !== 0) return cur;
  }
  return l.length - r.length;
}

function encodeMap(to: number[], entries: [string, unknown][]): void {
  const prepared = entries.map(([k, v]) => [Array.from(k, (c) => c.codePointAt(0)!), v] as [number[], unknown]);
  prepared.sort((a, b) => compareString(a[0], b[0]));
  for (let i = 1; i < prepared.length; i++) {
    if (compareString(prepared[i - 1][0], prepared[i][0]) === 0) {
      throw new Error(`duplicate calldata key '${prepared[i][0]}'`);
    }
  }
  encodeNumWithType(to, BigInt(prepared.length), TYPE_MAP);
  for (const [k, v] of prepared) {
    writeNum(to, BigInt(k.length));
    for (const c of k) to.push(c);
    encodeImpl(to, v);
  }
}

function encodeImpl(to: number[], data: unknown): void {
  if (data === null || data === undefined) {
    to.push(SPECIAL_NULL);
    return;
  }
  if (data === true) { to.push(SPECIAL_TRUE); return; }
  if (data === false) { to.push(SPECIAL_FALSE); return; }
  switch (typeof data) {
    case "number": {
      if (!Number.isInteger(data)) throw new Error(`floats not supported: ${data}`);
      encodeNum(to, BigInt(data));
      return;
    }
    case "bigint": encodeNum(to, data); return;
    case "string": {
      const str = new TextEncoder().encode(data);
      encodeNumWithType(to, BigInt(str.length), TYPE_STR);
      for (const c of str) to.push(c);
      return;
    }
    case "object": {
      if (data instanceof Uint8Array) {
        encodeNumWithType(to, BigInt(data.length), TYPE_BYTES);
        for (const c of data) to.push(c);
      } else if (data instanceof Array) {
        encodeNumWithType(to, BigInt(data.length), TYPE_ARR);
        for (const c of data) encodeImpl(to, c);
      } else if (data instanceof Map) {
        encodeMap(to, [...data.entries()]);
      } else {
        encodeMap(to, Object.entries(data as Record<string, unknown>));
      }
      return;
    }
    default:
      throw new Error(`invalid calldata input '${data}'`);
  }
}

export function encodeCalldata(data: unknown): Uint8Array {
  const to: number[] = [];
  encodeImpl(to, data);
  return new Uint8Array(to);
}

export function makeCalldataObject(
  method: string | undefined,
  args: unknown[] | undefined,
  kwargs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const ret: Record<string, unknown> = {};
  if (method) ret[""] = method;
  if (args && args.length > 0) ret["args"] = args;
  if (kwargs && Object.keys(kwargs).length > 0) ret["kwargs"] = kwargs;
  return ret;
}

export function encodeWriteTxData(functionName: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Hex {
  return toRlp([toHex(encodeCalldata(makeCalldataObject(functionName, args, kwargs))), "0x"]);
}

const ADD_TRANSACTION_V6 = [
  { name: "_sender", type: "address" },
  { name: "_recipient", type: "address" },
  { name: "_numOfInitialValidators", type: "uint256" },
  { name: "_maxRotations", type: "uint256" },
  { name: "_txData", type: "bytes" },
  { name: "_validUntil", type: "uint256" },
] as const;

const NEW_TX_EVENT = [{
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
    { indexed: true, internalType: "address", name: "recipient", type: "address" },
    { indexed: true, internalType: "address", name: "activator", type: "address" },
  ],
  name: "NewTransaction",
  type: "event",
}] as const;

const CREATED_TX_EVENT = [{
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "bytes32", name: "txId", type: "bytes32" },
    { indexed: false, internalType: "uint256", name: "txSlot", type: "uint256" },
  ],
  name: "CreatedTransaction",
  type: "event",
}] as const;

export function extractTxId(logs: readonly unknown[]): Hash | null {
  for (const [abi, name] of [[NEW_TX_EVENT, "NewTransaction"], [CREATED_TX_EVENT, "CreatedTransaction"]] as const) {
    try {
      const evs = parseEventLogs({ abi, eventName: name, logs: logs as never });
      if (evs.length > 0) return (evs[0].args as { txId: Hash }).txId;
    } catch {
      // try next event shape
    }
  }
  return null;
}

type MinimalAccount = {
  address: string;
  signTransaction: (tx: Record<string, unknown>) => Promise<`0x${string}`>;
};

export type MinimalClient = {
  account?: MinimalAccount;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

async function rpc<T = unknown>(client: MinimalClient, method: string, params: unknown[], tries = 6): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 1; i <= tries; i++) {
    lastErr = null;
    try {
      return (await client.request({ method, params })) as T;
    } catch (e) {
      lastErr = e;
      const msg = String((e as { details?: string; message?: string })?.details || (e as Error)?.message || e);
      if (!/ECONNRESET|fetch failed|terminated|rate limit|capacity|timeout/i.test(msg)) throw e;
      await sleep(2500 * i);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Broadcasts a flat AddTransaction carrying a write for `recipient` and
 * resolves the GenLayer tx id once the EVM AddTransaction is mined.
 * `value` rides as the EVM msg.value of the AddTransaction call — the same
 * lane the pre-upgrade struct encoding used for userValue (feeValue is 0
 * while Bradbury's fee policy is disabled); first live ingest verifies it
 * end-to-end (stake must land in the contract for ingest to pass).
 * Retries nonce conflicts locally (rejected pre-broadcast — no double-send).
 */
export async function broadcastWrite(
  client: MinimalClient,
  recipient: Address,
  txData: Hex,
  opts: { maxRotations?: bigint; validators?: bigint; validUntilSec?: number; value?: bigint } = {},
): Promise<Hash> {
  const account = client.account;
  if (!account?.signTransaction) {
    throw new Error("client.account with signTransaction is required for flat writes (create the client with createAccount(privateKey))");
  }
  const validators = opts.validators ?? 5n;
  const maxRotations = opts.maxRotations ?? 3n;
  const validUntil = BigInt(opts.validUntilSec ?? Math.floor(Date.now() / 1000) + 7200);
  const value = opts.value ?? 0n;
  const gasPrice = (BigInt(await rpc<string>(client, "eth_gasPrice", [])) * 3n) / 2n + 1n;
  const data = encodeFunctionData({
    abi: [{ type: "function", name: "addTransaction", stateMutability: "nonpayable", inputs: ADD_TRANSACTION_V6, outputs: [] }],
    functionName: "addTransaction",
    args: [account.address as Address, recipient, validators, maxRotations, txData, validUntil],
  });
  let gas = 2_000_000n;
  try {
    const est = await rpc<string>(client, "eth_estimateGas", [{ from: account.address, to: CONSENSUS_MAIN, data, value: toHex(value) }]);
    gas = (BigInt(est) * 12n) / 10n + 10_000n;
  } catch {
    // keep default gas on transient estimation failures
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const nonce = await rpc<string>(client, "eth_getTransactionCount", [account.address, "latest"]);
    const raw = await account.signTransaction({ to: CONSENSUS_MAIN, data, value, nonce: BigInt(nonce), gas, gasPrice, type: "legacy", chainId: 4221 });
    try {
      const evmHash = await rpc<Hash>(client, "eth_sendRawTransaction", [raw]);
      let receipt: { status?: string; logs?: unknown[] } | null = null;
      for (let i = 0; i < 120; i++) {
        await sleep(5000);
        receipt = await rpc<{ status?: string; logs?: unknown[] }>(client, "eth_getTransactionReceipt", [evmHash]).catch(() => null);
        if (receipt) break;
      }
      if (!receipt) throw new Error(`AddTransaction EVM tx ${evmHash} not mined in 10 min`);
      if (receipt.status !== "0x1") throw new Error(`AddTransaction EVM tx ${evmHash} reverted`);
      const genTxId = extractTxId(receipt.logs ?? []);
      if (!genTxId) throw new Error(`AddTransaction ${evmHash} mined but no NewTransaction/CreatedTransaction event`);
      return genTxId;
    } catch (e) {
      const msg = String((e as { details?: string })?.details || (e as Error)?.message || e);
      if (/nonce is not consistent|nonce too|replacement transaction|already known/i.test(msg)) {
        await sleep(2000);
        continue;
      }
      throw e;
    }
  }
  throw new Error("nonce conflict persisted after 5 attempts");
}

type Hex = `0x${string}`;
