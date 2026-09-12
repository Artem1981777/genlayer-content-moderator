// Deploy ContentModerator Registry v2 to GenLayer Testnet Bradbury.
// Two instances:
//   prod — production timeouts (86400 / 3600 / 172800 s)
//   demo — 60 s timeouts so permissionless-enforce / appeal-resolve /
//          reclaim liveness paths are provable without day-scale waits
// Writes deployments.json (v2) with real tx hashes; never fabricates results.
import { readFileSync, writeFileSync } from "node:fs";
import { TransactionStatus } from "genlayer-js/types";
import { accountFrom, clientFor, waitFinal, EXPLORER } from "./lib/client.mjs";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY missing. Run: node --env-file=.env scripts/deploy.mjs");

const RULES =
  "No spam or advertising. No scams, phishing, or requests for private keys or seed phrases. " +
  "No hate speech or harassment. No violence or threats. APPROVE compliant content, " +
  "FLAG borderline content, REMOVE clear violations.";

const PROD = {
  name: "prod",
  default_rules: RULES,
  min_stake: 1_000_000_000_000n,
  report_bond: 1_000_000_000_000n,
  appeal_bond: 2_000_000_000_000n,
  enforce_timeout_sec: 86400n,
  appeal_resolve_cooldown_sec: 3600n,
  appeal_timeout_sec: 172800n,
  llm_cooldown_sec: 60n,
  max_open_reports: 3,
  max_open_appeals: 2,
};

const DEMO = {
  ...PROD,
  name: "demo",
  enforce_timeout_sec: 60n,
  appeal_resolve_cooldown_sec: 60n,
  appeal_timeout_sec: 60n,
};

const source = readFileSync("contracts/registry_v2.py", "utf8");
const code = new TextEncoder().encode(source);
const account = accountFrom(PRIVATE_KEY);
const client = clientFor(account);
console.log("deployer:", account.address);

async function deployOne(cfg) {
  const args = [
    cfg.default_rules, cfg.min_stake, cfg.report_bond, cfg.appeal_bond,
    cfg.enforce_timeout_sec, cfg.appeal_resolve_cooldown_sec, cfg.appeal_timeout_sec,
    cfg.llm_cooldown_sec, cfg.max_open_reports, cfg.max_open_appeals,
  ];
  console.log(`Deploying registry_v2 (${cfg.name})...`);
  const txHash = await client.deployContract({ code, args });
  console.log("  deploy tx:", txHash);
  await client.waitForTransactionReceipt({ hash: txHash, status: TransactionStatus.ACCEPTED, retries: 400 });
  const tx = await waitFinal(client, txHash, "deploy " + cfg.name, 120);
  const address = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
  const ok = tx?.txExecutionResultName === "FINISHED" || tx?.txExecutionResultName === "FINISHED_WITH_RETURN";
  console.log(`  ${cfg.name}: ${address} (${tx?.txExecutionResultName})`);
  console.log("  explorer:", EXPLORER + "/tx/" + txHash);
  if (!ok) throw new Error("deploy not clean: " + tx?.txExecutionResultName);
  const cfgJson = JSON.parse(await client.readContract({
    address, functionName: "get_config", args: [],
  }));
  console.log("  config: min_stake=" + cfgJson.min_stake, "rules_version=" + cfgJson.rules_version,
    "owner=" + cfgJson.owner);
  return {
    address: String(address), txHash: String(txHash),
    txLink: EXPLORER + "/tx/" + txHash,
    params: {
      default_rules: cfg.default_rules,
      min_stake: String(cfg.min_stake), report_bond: String(cfg.report_bond),
      appeal_bond: String(cfg.appeal_bond),
      enforce_timeout_sec: String(cfg.enforce_timeout_sec),
      appeal_resolve_cooldown_sec: String(cfg.appeal_resolve_cooldown_sec),
      appeal_timeout_sec: String(cfg.appeal_timeout_sec),
      llm_cooldown_sec: String(cfg.llm_cooldown_sec),
      max_open_reports: cfg.max_open_reports, max_open_appeals: cfg.max_open_appeals,
    },
    owner: cfgJson.owner,
  };
}

const deployments = {
  version: "2.0.0",
  contract: "contracts/registry_v2.py",
  chain: "genlayer-testnet-bradbury (chain id 4221)",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  prod: null,
  demo: null,
};
deployments.prod = await deployOne(PROD);
deployments.demo = await deployOne(DEMO);
writeFileSync("deployments.json", JSON.stringify(deployments, null, 2));
console.log("=== deployments.json written ===");
console.log("prod:", deployments.prod.address);
console.log("demo:", deployments.demo.address);
