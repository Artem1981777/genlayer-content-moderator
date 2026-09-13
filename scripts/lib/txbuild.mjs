// Flat AddTransaction builder for the Bradbury consensus contract.
// The on-chain consensus main (0x0112Bf…) exposes only the flat
// addTransaction(address,address,uint256,uint256,bytes,uint256) entrypoint
// (V6, selector 0xe71d5196); the struct-variant encoded by current
// genlayer-js releases reverts. Verified on-chain via eth_call 2026-09-13.
// Mirrors the official genlayer CLI (0.39.x) _encodeAddTransactionData.
import { encodeFunctionData, toRlp, toHex } from "viem";
import { encode, makeCalldataObject } from "./calldata.mjs";

export const CONSENSUS_MAIN = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D";

const ADD_TRANSACTION_V6 = [
  { name: "_sender", type: "address" },
  { name: "_recipient", type: "address" },
  { name: "_numOfInitialValidators", type: "uint256" },
  { name: "_maxRotations", type: "uint256" },
  { name: "_txData", type: "bytes" },
  { name: "_validUntil", type: "uint256" },
];

const ADD_TRANSACTION_V5 = ADD_TRANSACTION_V6.slice(0, 5);

export function encodeDeployTxData(codeBytes, constructorArgs = []) {
  return toRlp([toHex(codeBytes), toHex(encode(makeCalldataObject(undefined, constructorArgs, {}))), "0x"]);
}

export function encodeWriteTxData(functionName, args = [], kwargs = {}) {
  return toRlp([toHex(encode(makeCalldataObject(functionName, args, kwargs))), "0x"]);
}

// kind: "deploy" → recipient must be zero address; "write" → recipient = contract
export function encodeAddTransactionV6({ sender, recipient, txData, validators = 5n, maxRotations = 3n, validUntil }) {
  return encodeFunctionData({
    abi: [{ type: "function", name: "addTransaction", stateMutability: "nonpayable", inputs: ADD_TRANSACTION_V6, outputs: [] }],
    functionName: "addTransaction",
    args: [sender, recipient, validators, maxRotations, txData, validUntil],
  });
}

export function encodeAddTransactionV5({ sender, recipient, txData, validators = 5n, maxRotations = 3n }) {
  return encodeFunctionData({
    abi: [{ type: "function", name: "addTransaction", stateMutability: "nonpayable", inputs: ADD_TRANSACTION_V5, outputs: [] }],
    functionName: "addTransaction",
    args: [sender, recipient, validators, maxRotations, txData],
  });
}

// Signs and returns { raw, evmValue... } — a legacy EVM tx to the consensus
// main contract carrying the AddTransaction calldata.
export async function signAddTransaction(account, { recipient, txData, nonce, gas, gasPrice, validUntilSec, validators, maxRotations }) {
  const data = encodeAddTransactionV6({
    sender: account.address,
    recipient,
    txData,
    validators,
    maxRotations,
    validUntil: BigInt(validUntilSec),
  });
  const raw = await account.signTransaction({
    to: CONSENSUS_MAIN,
    data,
    value: 0n,
    nonce,
    gas,
    gasPrice,
    type: "legacy",
    chainId: 4221,
  });
  return { raw, data };
}
