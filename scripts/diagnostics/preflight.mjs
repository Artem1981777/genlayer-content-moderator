// Preflight gate for the deploy workflow: fails with a clear message BEFORE
// any broadcast if the environment cannot support a deploy.
// env-report.mjs has already printed chainId/balance/nonce details.
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

if (!process.env.PRIVATE_KEY) {
  console.error("::error::PRIVATE_KEY is not set");
  process.exit(1);
}
const acct = createAccount(process.env.PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account: acct });

const chainId = await client.request({ method: "eth_chainId", params: [] }).catch(() => null);
if (chainId !== "0x107d") {
  console.error(`::error::wrong chain: eth_chainId=${chainId}, expected 0x107d (Bradbury)`);
  process.exit(1);
}

let balanceGen = 0;
try {
  const bal = await client.request({ method: "eth_getBalance", params: [acct.address, "latest"] });
  balanceGen = Number(BigInt(bal)) / 1e18;
} catch (e) {
  console.error(`::error::cannot read deployer balance: ${String(e?.details || e?.message).slice(0, 120)}`);
  process.exit(1);
}
if (balanceGen < 1) {
  console.error(`::error::deployer ${acct.address} balance ${balanceGen.toFixed(4)} GEN is below the 1 GEN deploy threshold`);
  process.exit(1);
}
console.log(`preflight OK: chain 0x107d, deployer ${acct.address}, balance ${balanceGen.toFixed(4)} GEN`);
