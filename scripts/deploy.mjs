// Deploy ContentModerator Registry v2 to GenLayer Testnet Bradbury.
// Resumable: deploy-state.json remembers broadcast tx hashes; a rerun polls
// them to finality instead of broadcasting again (no double deploys).
// Two instances:
//   prod — production timeouts (86400 / 3600 / 172800 s)
//   demo — 60 s timeouts so permissionless-enforce / appeal-resolve /
//          reclaim liveness paths are provable without day-scale waits
// Writes deployments.json (v2) with real tx hashes; never fabricates results.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { TransactionStatus } from "genlayer-js/types";
import { accountFrom, clientFor, waitFinal, sleep, EXPLORER } from "./lib/client.mjs";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY missing. Run: node --env-file=.env scripts/deploy.mjs");

const STATE_PATH = "deploy-state.json";
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};

function saveState() {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

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

const EXPLORER_RPC = "https://rpc-bradbury.genlayer.com";

async function nonce(addr) {
  const r = await fetch(EXPLORER_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [addr, "latest"] }),
  });
  const j = await r.json();
  return BigInt(j.result ?? "0x0");
}

// Deploy is not idempotent: retry network failures only when the account
// nonce did not move (proves the failed attempt never broadcast).
async function deployContractSafe(payload) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const n0 = await nonce(account.address);
    try {
      return await client.deployContract(payload);
    } catch (e) {
      const msg = e?.message || String(e);
      const n1 = await nonce(account.address);
      console.log(`  deploy attempt ${attempt} failed (${msg.slice(0, 80)}), nonce ${n0} -> ${n1}`);
      if (n1 !== n0) throw new Error("deploy may have broadcast (nonce moved) — aborting to avoid double deploy");
      if (attempt === 5) throw e;
      await sleep(15000);
    }
  }
}

async function deployOne(cfg) {
  if (state[cfg.name]?.address) {
    console.log(`${cfg.name}: already deployed at ${state[cfg.name].address}`);
    return state[cfg.name];
  }
  // resume: a tx was already broadcast — poll it instead of re-deploying
  if (state[cfg.name]?.txHash) {
    console.log(`${cfg.name}: resuming pending deploy tx ${state[cfg.name].txHash}`);
    return await settle(cfg, state[cfg.name].txHash);
  }
  const args = [
    cfg.default_rules, cfg.min_stake, cfg.report_bond, cfg.appeal_bond,
    cfg.enforce_timeout_sec, cfg.appeal_resolve_cooldown_sec, cfg.appeal_timeout_sec,
    cfg.llm_cooldown_sec, cfg.max_open_reports, cfg.max_open_appeals,
  ];
  console.log(`Deploying registry_v2 (${cfg.name})...`);
  const txHash = await deployContractSafe({ code, args });
  console.log("  deploy tx:", txHash);
  state[cfg.name] = { txHash: String(txHash) };
  saveState(); // persist BEFORE waiting: a rerun resumes instead of double-deploying
  return await settle(cfg, String(txHash));
}

async function settle(cfg, txHash) {
  // patient finality poll: contract-deploy consensus can take minutes
  let tx = null;
  for (let i = 0; i < 120; i++) {
    try {
      tx = await client.getTransaction({ hash: txHash });
      const rn = String(tx?.txExecutionResultName || "");
      if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") break;
      if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) {
        throw new Error(`deploy ${cfg.name} failed on-chain: ${rn}`);
      }
      if (i % 5 === 0) console.log(`  ${cfg.name}: consensus... (${rn || "pending"})`);
    } catch (e) {
      if (/failed on-chain/.test(String(e))) throw e;
    }
    await sleep(6000);
    tx = null;
  }
  if (!tx) throw new Error(`timeout waiting for ${cfg.name} deploy finality`);
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
  const record = {
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
  state[cfg.name] = record;
  saveState();
  return record;
}

const deployments = {
  version: "2.0.0",
  contract: "contracts/registry_v2.py",
  chain: "genlayer-testnet-bradbury (chain id 4221)",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  prod: await deployOne(PROD),
  demo: await deployOne(DEMO),
};
writeFileSync("deployments.json", JSON.stringify(deployments, null, 2));
console.log("=== deployments.json written ===");
console.log("prod:", deployments.prod.address);
console.log("demo:", deployments.demo.address);
