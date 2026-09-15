import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { encodeDeployTxData, encodeAddTransactionV6 } from "../lib/txbuild.mjs";
import { CONSENSUS_MAIN } from "../lib/config.mjs";

const key = process.env.PRIVATE_KEY;
if (!key) throw new Error("PRIVATE_KEY missing");
const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });
const rules = "No spam, scams, phishing, hate, harassment, violence, or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const candidates = [
  { name: "v2-full", file: "contracts/registry_v2.py", args: [rules, 1_000_000_000_000n, 1_000_000_000_000n, 2_000_000_000_000n, 86400n, 3600n, 172800n, 60n, 3, 2] },
  { name: "v2-lite", file: "contracts/moderator_lite.py", args: [rules] },
  { name: "v1.2-registry", file: "contracts/registry.py", args: [rules] },
  { name: "v0.5-moderator", file: "contracts/moderator.py", args: [rules] },
];
for (const candidate of candidates) {
  const code = new TextEncoder().encode(readFileSync(candidate.file, "utf8"));
  const txData = encodeDeployTxData(code, candidate.args);
  const data = encodeAddTransactionV6({
    sender: account.address,
    recipient: "0x0000000000000000000000000000000000000000",
    txData,
    validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });
  const bytes = (data.length - 2) / 2;
  try {
    const gas = await client.request({ method: "eth_estimateGas", params: [{ from: account.address, to: CONSENSUS_MAIN, data }] });
    console.log(JSON.stringify({ name: candidate.name, sourceBytes: code.length, calldataBytes: bytes, estimateGas: gas, acceptedByRpc: true }));
  } catch (error) {
    console.log(JSON.stringify({ name: candidate.name, sourceBytes: code.length, calldataBytes: bytes, acceptedByRpc: false, error: String(error?.message || error).split("Details:")[0].slice(0, 240) }));
  }
}
