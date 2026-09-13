// Deploy ContentModerator Registry v2 to GenLayer Testnet Bradbury.
// Uses the flat AddTransaction path (scripts/lib/sender.mjs): the Bradbury
// consensus contract only accepts addTransaction(_sender,_recipient,
// _validators,_maxRotations,_txData,_validUntil); the struct variant encoded
// by genlayer-js ≤2.0.0-rc.1 reverts on-chain (verified via eth_call).
// Resumable: deploy-state.json remembers broadcast tx ids; a rerun polls them
// to finality instead of broadcasting again (no double deploys).
// Two instances:
//   prod — production timeouts (86400 / 3600 / 172800 s)
//   demo — 60 s timeouts so permissionless-enforce / appeal-resolve /
//          reclaim liveness paths are provable without day-scale waits
// Writes deployments.json (v2) with real tx hashes; never fabricates results.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { accountFrom, clientFor, sleep, EXPLORER } from "./lib/client.mjs";
import { encodeDeployTxData } from "./lib/txbuild.mjs";
import { broadcastAddTransaction, waitFinality, rawRpc } from "./lib/sender.mjs";

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
const rpc = rawRpc(client);
console.log("deployer:", account.address, "| code bytes:", code.length);

function argsOf(cfg) {
  return [
    cfg.default_rules, cfg.min_stake, cfg.report_bond, cfg.appeal_bond,
    cfg.enforce_timeout_sec, cfg.appeal_resolve_cooldown_sec, cfg.appeal_timeout_sec,
    cfg.llm_cooldown_sec, cfg.max_open_reports, cfg.max_open_appeals,
  ];
}

// Broadcast is not idempotent: only retry transport-level errors when the
// account nonce did not move (proves the attempt never reached the node).
async function broadcastSafe(cfg) {
  const txData = encodeDeployTxData(code, argsOf(cfg));
  for (let attempt = 1; attempt <= 5; attempt++) {
    const n0 = await rpc("eth_getTransactionCount", [account.address, "latest"]);
    try {
      const { genTxId, evmHash } = await broadcastAddTransaction(client, account, {
        recipient: "0x0000000000000000000000000000000000000000", txData,
      });
      return { genTxId, evmHash };
    } catch (e) {
      const msg = e?.message || String(e);
      const n1 = await rpc("eth_getTransactionCount", [account.address, "latest"]).catch(() => "?");
      console.log(`  ${cfg.name} deploy attempt ${attempt} failed (${msg.slice(0, 90)}), nonce ${n0} -> ${n1}`);
      if (String(n1) !== String(n0)) throw new Error("deploy may have broadcast (nonce moved) — aborting to avoid double deploy");
      if (attempt === 5) throw e;
      await sleep(15000);
    }
  }
}

async function settle(cfg, genTxId) {
  let tx;
  try {
    tx = await waitFinality(client, genTxId, cfg.name + " deploy", 120);
  } catch (e) {
    if (/exec failed|canceled/i.test(String(e))) throw e;
    return null; // timeout → treat as dropped, caller re-broadcasts
  }
  const address = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
  console.log(`  ${cfg.name}: ${address} (${tx?.txExecutionResultName})`);
  console.log("  explorer:", EXPLORER + "/tx/" + genTxId);
  const cfgJson = JSON.parse(await client.readContract({ address, functionName: "get_config", args: [] }));
  console.log("  config: min_stake=" + cfgJson.min_stake, "rules_version=" + cfgJson.rules_version, "owner=" + cfgJson.owner);
  const record = {
    address: String(address), txHash: String(genTxId),
    txLink: EXPLORER + "/tx/" + genTxId,
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

async function deployOne(cfg) {
  if (state[cfg.name]?.address) {
    console.log(`${cfg.name}: already deployed at ${state[cfg.name].address}`);
    return state[cfg.name];
  }
  // resume: a tx was already broadcast — poll it instead of re-deploying
  if (state[cfg.name]?.txHash) {
    console.log(`${cfg.name}: resuming pending deploy tx ${state[cfg.name].txHash}`);
    const settled = await settle(cfg, state[cfg.name].txHash).catch((e) => {
      if (/exec failed|canceled/i.test(String(e))) throw e;
      return null;
    });
    if (settled) return settled;
    console.log(`${cfg.name}: re-broadcasting after dropped tx`);
    delete state[cfg.name];
    saveState();
  }
  console.log(`Deploying registry_v2 (${cfg.name})...`);
  const { genTxId } = await broadcastSafe(cfg);
  console.log("  deploy genTxId:", genTxId);
  state[cfg.name] = { txHash: String(genTxId) };
  saveState(); // persist BEFORE waiting: a rerun resumes instead of double-deploying
  const settled = await settle(cfg, genTxId);
  if (!settled) throw new Error(`${cfg.name}: deploy tx dropped from queue; re-run to retry`);
  return settled;
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
