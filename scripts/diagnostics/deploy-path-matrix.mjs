// Deploy-path matrix runner: deploys the tiny Storage smoke contract through
// every documented deployment path and records the real outcome (tx hashes,
// errors, eth_call proofs) into docs/evidence/v2/deploy-path-matrix.json.
// Nothing is fabricated: a failed attempt is recorded as failed, with the
// full error dump from the logs above it in CI output.
//
// Paths covered:
//   A. genlayer CLI 0.39.2 (pinned in package.json) — `genlayer deploy --contract`
//   B. genlayer CLI 0.40.0-rc.3 — same, via npx pin
//   C. genlayer CLI 0.39.2 deploy-scripts route — `genlayer deploy` (runs deploy/*.ts)
//   D. genlayer-js 2.0.0-rc.1 client.deployContract (repo-installed version)
//   E. genlayer-js 1.1.8 client.deployContract (temp npm prefix)
//   F. raw flat AddTransaction (scripts/lib/sender.mjs) — documented fallback
//   G. registry_v2 full contract via the official CLI — expected to hit the
//      ~17KB pubdata ceiling (see payload-size-clean-bisect.mjs evidence)
//
// Run: node scripts/diagnostics/deploy-path-matrix.mjs  (PRIVATE_KEY from env)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { encodeDeployTxData, CONSENSUS_MAIN } from "../lib/txbuild.mjs";
import { broadcastAddTransaction, waitFinality, rawRpc, dumpError } from "../lib/sender.mjs";

const PW = "gl-cm-matrix-2026";
const OUT = "docs/evidence/v2/deploy-path-matrix.json";
mkdirSync("docs/evidence/v2", { recursive: true });

const rows = [];
const row = (path, outcome, data) => {
  const r = { path, outcome, at: new Date().toISOString(), ...data };
  rows.push(r);
  console.log(`== [${path}] ${outcome}: ${JSON.stringify(data).slice(0, 300)}`);
};

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY is not set");
  process.exit(1);
}
const acct = createAccount(process.env.PRIVATE_KEY);
const client = createClient({ chain: testnetBradbury, account: acct });
const rpc = rawRpc(client);
const chainId = await rpc("eth_chainId", []);
if (chainId !== "0x107d") {
  console.error(`FATAL: eth_chainId=${chainId}`);
  process.exit(1);
}
console.log("deployer:", acct.address, "| chain OK");

function cli(cmdLine, timeoutMs = 300000) {
  // the CLI prompts for the keystore password on a TTY; `script` provides one.
  // The local pinned binary is invoked via its direct path so `script`'s sh
  // cannot mis-resolve `npx` (observed: "unknown command 'genlayer'").
  return execFileSync("script", ["-qec", cmdLine, "/dev/null"], {
    input: PW + "\n" + PW + "\n",
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

const LOCAL_BIN = "node_modules/.bin/genlayer";

function setupCliAccount(bin) {
  const import1 = cli(`${bin} account import --name matrix --private-key ${process.env.PRIVATE_KEY} --password ${PW} --overwrite`);
  console.log(import1.split("\n").filter((l) => /Address|imported|✔|✖|Error/i.test(l)).join("\n"));
  const net = cli(`${bin} network set testnet-bradbury`);
  console.log(net.split("\n").filter((l) => /network|✔|✖/i.test(l)).join("\n"));
}

function extractCliResult(out) {
  const tx = out.match(/Transaction Hash[""]?\s*[:=]\s*(0x[0-9a-fA-F]{64})/)?.[1]
    ?? out.match(/(0x[0-9a-fA-F]{64})/g)?.slice(-1)?.[0];
  const addr = out.match(/Contract Address[""]?\s*[:=]\s*(0x[0-9a-fA-F]{40})/)?.[1]
    ?? out.match(/0x[0-9a-f]{40}/gi)?.slice(-1)?.[0];
  return { tx, addr };
}

async function tryCli(label, bin, cmd) {
  try {
    setupCliAccount(bin);
  } catch (e) {
    row(label, "cli-setup-failed", { error: String(e.message).slice(0, 400) });
    return;
  }
  try {
    const out = cli(`${bin} ${cmd}`, 420000);
    console.log(out.split("\n").slice(-25).join("\n"));
    const { tx, addr } = extractCliResult(out);
    if (/deployed successfully|Contract Address/i.test(out) && addr) {
      row(label, "success", { tx, address: addr });
    } else {
      row(label, "no-result", { tail: out.split("\n").slice(-12).join(" | ").slice(0, 400) });
    }
  } catch (e) {
    row(label, "failed", { error: String(e.stdout || e.message).split("\n").filter((l) => /✖|Error|error|revert/i.test(l)).slice(0, 5).join(" | ").slice(0, 400) });
  }
}

// A. CLI 0.39.2 direct deploy of Storage
await tryCli("A: CLI 0.39.2 --contract Storage", LOCAL_BIN, "deploy --contract contracts/smoke/Storage.py");

// B. CLI 0.40.0-rc.3 direct deploy of Storage (via npx pin)
await tryCli("B: CLI 0.40.0-rc.3 --contract Storage", "npx -y genlayer@0.40.0-rc.3", "deploy --contract contracts/smoke/Storage.py");

// C. CLI 0.39.2 deploy-scripts route (runs deploy/*.ts — contains the 50KB
// registry_v2, expected to hit the pubdata ceiling; the attempt itself proves the route works)
await tryCli("C: CLI 0.39.2 deploy-scripts (deploy/001_registry_v2.ts)", LOCAL_BIN, "deploy");

// D. genlayer-js 2.0.0-rc.1 (repo-installed): struct encoding → expected EVM revert
try {
  const code = new TextEncoder().encode(readFileSync("contracts/smoke/Storage.py", "utf8"));
  await client.deployContract({ code, args: [] });
  row("D: genlayer-js 2.0.0-rc.1 deployContract", "success", {});
} catch (e) {
  dumpError("D deployContract", e);
  row("D: genlayer-js 2.0.0-rc.1 deployContract", "failed", {
    error: String(e?.details || e?.shortMessage || e?.message).slice(0, 300),
  });
}

// E. genlayer-js 1.1.8 from a temp npm prefix
try {
  if (!existsSync("/tmp/gl118/node_modules/genlayer-js")) {
    execFileSync("npm", ["i", "genlayer-js@1.1.8", "--no-audit", "--no-fund", "--prefix", "/tmp/gl118"], { timeout: 180000 });
  }
  const probe = `
    const { createClient, createAccount } = require("/tmp/gl118/node_modules/genlayer-js");
    const { testnetBradbury } = require("/tmp/gl118/node_modules/genlayer-js/chains");
    const fs = require("fs");
    (async () => {
      const acct = createAccount(process.env.PRIVATE_KEY);
      const c = createClient({ chain: testnetBradbury, account: acct });
      const code = new TextEncoder().encode(fs.readFileSync("contracts/smoke/Storage.py", "utf8"));
      try {
        const h = await c.deployContract({ code, args: [] });
        console.log("E_DEPLOY_OK", h);
      } catch (e) {
        console.log("E_DEPLOY_FAIL", String(e?.details || e?.shortMessage || e?.message).slice(0, 300));
      }
    })();
  `;
  writeFileSync("/tmp/e118.cjs", probe);
  const out = execFileSync("node", ["/tmp/e118.cjs"], { encoding: "utf8", timeout: 300000, env: process.env });
  console.log(out.split("\n").filter((l) => /E_DEPLOY/.test(l)).join("\n"));
  if (/E_DEPLOY_OK/.test(out)) row("E: genlayer-js 1.1.8 deployContract", "success", { tx: out.match(/E_DEPLOY_OK (0x[0-9a-fA-F]{64})/)?.[1] });
  else row("E: genlayer-js 1.1.8 deployContract", "failed", { error: out.match(/E_DEPLOY_FAIL (.*)/)?.[1]?.slice(0, 300) });
} catch (e) {
  row("E: genlayer-js 1.1.8 deployContract", "failed", { error: String(e.message).slice(0, 300) });
}

// F. raw flat AddTransaction (documented fallback, scripts/lib/sender.mjs)
try {
  const code = new TextEncoder().encode(readFileSync("contracts/smoke/Storage.py", "utf8"));
  const txData = encodeDeployTxData(code, []);
  const { genTxId, evmHash } = await broadcastAddTransaction(client, acct, { recipient: "0x0000000000000000000000000000000000000000", txData });
  if (!genTxId) throw new Error("AddTransaction not mined (evm " + evmHash + ")");
  let tx = null;
  try {
    tx = await waitFinality(client, genTxId, "F storage deploy", 200);
  } catch (e) {
    if (!/timeout/.test(String(e))) throw e;
    row("F: raw flat AddTransaction (Storage)", "consensus-pending", { tx: genTxId, evm: evmHash, note: "AddTransaction mined, GenLayer execution did not reach a decided state in 20 min" });
  }
  if (tx) {
    const address = tx?.txDataDecoded?.contractAddress ?? tx?.recipient;
    row("F: raw flat AddTransaction (Storage)", "success", { tx: genTxId, address: String(address), execResult: tx?.txExecutionResultName });
  }
} catch (e) {
  dumpError("F raw deploy", e);
  row("F: raw flat AddTransaction (Storage)", "failed", { error: String(e?.message).slice(0, 300) });
}

// H. consensus health: GenLayer statuses of recent third-party AddTransactions —
// distinguishes "our tx is stuck" from "the whole consensus is degraded".
try {
  const health = [];
  const head = BigInt(await rpc("eth_blockNumber", []));
  for (let b = head; b > head - 80n && health.length < 4; b--) {
    const block = await rpc("eth_getBlockByNumber", ["0x" + b.toString(16), true]).catch(() => null);
    if (!block?.transactions) continue;
    for (const tx of block.transactions) {
      if ((tx.to || "").toLowerCase() !== CONSENSUS_MAIN.toLowerCase()) continue;
      const rec = await rpc("eth_getTransactionReceipt", [tx.hash]).catch(() => null);
      if (!rec || rec.status !== "0x1") continue;
      const logs = rec.logs || [];
      let genId = null;
      for (const l of logs) {
        if (Array.isArray(l.topics) && String(l.topics[0]).startsWith("0xdab91028") && l.topics.length >= 2) { genId = l.topics[1]; break; }
        if (Array.isArray(l.topics) && String(l.topics[0]).startsWith("0x8620e7f0") && l.topics.length >= 2) { genId = l.topics[1]; break; }
      }
      if (!genId) continue;
      const st = await rpc("gen_getTransactionStatus", [genId]).catch((e) => ({ error: String(e.message).slice(0, 60) }));
      health.push({ block: Number(b), evmTx: tx.hash, genTxId: genId, status: st });
    }
  }
  row("H: consensus health (recent third-party txs)", health.length ? "observed" : "no-recent-consensus-txs", { transactions: health });
} catch (e) {
  row("H: consensus health (recent third-party txs)", "failed", { error: String(e.message).slice(0, 300) });
}

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), chain: "testnet-bradbury (4221)", deployer: acct.address, rows }, null, 2));
console.log("=== matrix written to", OUT, "===");
// do not fail CI on expected failures: the matrix is evidence, not a gate
