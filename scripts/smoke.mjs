// Post-deploy smoke test for ContentModerator registry v2 (prod + demo).
// Reads get_config() from both instances, performs ONE demo write (ingest of
// a unique item at the demo min_stake), waits for finality and asserts
// FINISHED_WITH_RETURN, then reads the item back. On failure, dumps
// debugTraceTransaction output when the node supports it.
// Result: docs/evidence/v2/smoke-<date>.json with explorer tx links.
//
// Run: node --env-file=.env scripts/smoke.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { encodeWriteTxData } from "./lib/txbuild.mjs";
import { broadcastAddTransaction, waitFinality, rawRpc, dumpError } from "./lib/sender.mjs";
import { EXPLORER } from "./lib/client.mjs";

if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing (env or .env)");
if (!existsSync("deployments.json")) throw new Error("deployments.json missing — run scripts/deploy.mjs first");

const DEP = JSON.parse(readFileSync("deployments.json", "utf8"));
const PROD = DEP.prod?.address;
const DEMO = DEP.demo?.address;
if (!PROD || !DEMO) throw new Error("deployments.json lacks prod/demo addresses");

const acct = createAccount(process.env.PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account: acct });
const rpc = rawRpc(client);

const report = {
  generatedAt: new Date().toISOString(),
  chain: "genlayer-testnet-bradbury (4221)",
  deployer: acct.address,
  prod: { address: PROD }, demo: { address: DEMO },
  checks: [],
};

function record(name, ok, data) {
  report.checks.push({ name, ok, at: new Date().toISOString(), ...data });
  console.log(`${ok ? "✔" : "✖"} ${name}`, JSON.stringify(data).slice(0, 240));
}

async function readJson(address, fn, args = []) {
  const raw = await client.readContract({ address, functionName: fn, args });
  return raw === "" || raw == null ? null : JSON.parse(raw);
}

// 1. prod get_config
try {
  const cfg = await readJson(PROD, "get_config");
  const ok = cfg && cfg.owner && Number(cfg.min_stake) > 0 && Number(cfg.rules_version) >= 1;
  record("prod.get_config", !!ok, { owner: cfg?.owner, min_stake: cfg?.min_stake, rules_version: cfg?.rules_version });
} catch (e) {
  dumpError("prod.get_config", e);
  record("prod.get_config", false, { error: String(e?.message).slice(0, 200) });
}

// 2. demo get_config
let demoCfg = null;
try {
  demoCfg = await readJson(DEMO, "get_config");
  const ok = demoCfg && Number(demoCfg.enforce_timeout_sec) === 60;
  record("demo.get_config", !!ok, { min_stake: demoCfg?.min_stake, enforce_timeout_sec: demoCfg?.enforce_timeout_sec });
} catch (e) {
  dumpError("demo.get_config", e);
  record("demo.get_config", false, { error: String(e?.message).slice(0, 200) });
}

// 3. one demo write: ingest a unique benign item
if (demoCfg) {
  const itemId = `smoke-${Date.now()}`;
  const url = `https://artem1981777.github.io/genlayer-content-moderator/fixtures/benign.html?smoke=${itemId}`;
  try {
    const stake = BigInt(demoCfg.min_stake);
    const txData = encodeWriteTxData("ingest", [itemId, url], {});
    const { genTxId, evmHash } = await broadcastAddTransaction(client, acct, { recipient: DEMO, txData, validUntilSec: Math.floor(Date.now() / 1000) + 3600 });
    console.log("ingest genTxId:", genTxId, "| evm:", evmHash);
    const tx = await waitFinality(client, genTxId, "smoke ingest", 100);
    const ok = tx?.txExecutionResultName === "FINISHED_WITH_RETURN";
    record("demo.ingest", ok, {
      item_id: itemId, tx: genTxId,
      txLink: EXPLORER + "/tx/" + genTxId,
      txExecutionResultName: tx?.txExecutionResultName,
      statusName: tx?.statusName,
    });
    // 4. read back
    const item = await readJson(DEMO, "get_item", [itemId]);
    record("demo.get_item", !!item && item.id === itemId, {
      id: item?.id, status: item?.status, verdict: item?.verdict ?? "(pending moderation)",
    });
  } catch (e) {
    dumpError("demo.ingest", e);
    record("demo.ingest", false, { error: String(e?.message).slice(0, 300) });
    // debug trace on the last known hash when available
    try {
      const trace = await client.debugTraceTransaction({ hash: e?.message?.match(/0x[0-9a-f]{64}/)?.[0] });
      console.log("debugTrace:", JSON.stringify(trace, (_, v) => typeof v === "bigint" ? String(v) : v).slice(0, 1500));
    } catch (te) {
      console.log("debugTrace unavailable:", String(te?.details || te?.message).slice(0, 120));
    }
  }
}

report.allOk = report.checks.length > 0 && report.checks.every((c) => c.ok);
const out = `docs/evidence/v2/smoke-${new Date().toISOString().slice(0, 10)}.json`;
mkdirSync("docs/evidence/v2", { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`=== smoke report: ${out} (allOk=${report.allOk}) ===`);
process.exit(report.allOk ? 0 : 1);
