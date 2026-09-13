// Official deploy-script path (docs.genlayer.com → Deploying → Deploy scripts):
// the genlayer CLI loads deploy/*.ts in filename order and passes its configured
// GenLayerJS client (whose consensus encoding matches the current Bradbury
// consensus contract) to each script's default-exported function.
//
// Intentionally imports nothing but node:fs: the CLI transpiles with esbuild
// (bundle: false) and executes the file itself, so the script must not depend
// on repo-local node_modules. Finality/Success checks mirror the documented
// pattern (waitForTransactionReceipt + isSuccessful semantics inlined).
import { readFileSync } from "node:fs";

const RULES =
  "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. " +
  "No hate speech or harassment. No violence or threats. APPROVE compliant content, " +
  "FLAG borderline content, REMOVE clear violations.";

const ARGS = [
  RULES,
  1_000_000_000_000n, // min_stake
  1_000_000_000_000n, // report_bond
  2_000_000_000_000n, // appeal_bond
  86_400n, // enforce_timeout_sec
  3_600n, // appeal_resolve_cooldown_sec
  172_800n, // appeal_timeout_sec
  60n, // llm_cooldown_sec
  3, // max_open_reports
  2, // max_open_appeals
];

export default async function main(client) {
  const code = new Uint8Array(readFileSync(new URL("../contracts/registry_v2.py", import.meta.url)));
  console.log("deploy/001_registry_v2.ts: code bytes:", code.length);
  const txHash = await client.deployContract({ code, args: ARGS });
  console.log("deploy tx:", txHash);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, retries: 200 });
  const statusOk = receipt?.statusName === "ACCEPTED" || receipt?.statusName === "FINALIZED";
  const execOk = receipt?.txExecutionResultName === "FINISHED" || receipt?.txExecutionResultName === "FINISHED_WITH_RETURN";
  if (!statusOk || !execOk) {
    throw new Error(`Deployment failed: ${receipt?.statusName} / ${receipt?.txExecutionResultName}`);
  }
  const address = receipt.txDataDecoded?.contractAddress ?? receipt.recipient;
  if (!address) throw new Error("Finalized deployment has no contract address");
  console.log("registry_v2 (prod) deployed:", { txHash, address });
  return address;
}
