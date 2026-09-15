// Deploy the compact ContentModeratorLite demo once to Bradbury.
// State is persisted before waiting so an interrupted run can resume safely.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { accountFrom, clientFor, sleep, EXPLORER } from "./lib/client.mjs";
import { encodeDeployTxData } from "./lib/txbuild.mjs";
import { broadcastAddTransaction, waitFinality, rawRpc, dumpError } from "./lib/sender.mjs";

const key = process.env.PRIVATE_KEY;
if (!key) throw new Error("PRIVATE_KEY missing");
const statePath = "lite-deploy-state.json";
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (state.address) {
  console.log("lightweight demo already deployed:", state.address);
  process.exit(0);
}
const rules = "No spam, scams, phishing, hate, harassment, violence, or threats. APPROVE compliant content, FLAG borderline content, REMOVE clear violations.";
const account = accountFrom(key);
const client = clientFor(account);
const rpc = rawRpc(client);
const code = new TextEncoder().encode(readFileSync("contracts/moderator_lite.py", "utf8"));
const txData = encodeDeployTxData(code, [rules]);
console.log("deployer:", account.address, "source bytes:", code.length, "txData bytes:", (txData.length - 2) / 2);
const nonce = await rpc("eth_getTransactionCount", [account.address, "latest"]);
try {
  const sent = await broadcastAddTransaction(client, account, {
    recipient: "0x0000000000000000000000000000000000000000",
    txData,
  });
  state.genTxId = String(sent.genTxId || "");
  state.evmTxHash = String(sent.evmHash || "");
  state.contract = "contracts/moderator_lite.py";
  state.chain = "genlayer-testnet-bradbury";
  save();
  console.log("broadcast recorded:", JSON.stringify(state));
  if (!sent.genTxId) throw new Error("No GenLayer tx id returned; rerun to resume by EVM hash");
  const tx = await waitFinality(client, sent.genTxId, "lightweight demo deploy", 120);
  const address = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
  if (!address) throw new Error("Finalized deployment has no contract address");
  state.address = String(address);
  state.txLink = EXPLORER + "/tx/" + sent.genTxId;
  save();
  console.log("LIGHTWEIGHT_DEMO_ADDRESS=" + state.address);
  console.log("LIGHTWEIGHT_DEMO_TX=" + state.txLink);
} catch (error) {
  dumpError("lightweight demo deploy", error);
  const after = await rpc("eth_getTransactionCount", [account.address, "latest"]).catch(() => "?");
  if (String(after) !== String(nonce)) throw new Error("Nonce changed after ambiguous failure; inspect lite-deploy-state.json before retry");
  throw error;
}
