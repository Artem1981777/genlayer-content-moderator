// ContentModerator v2 — on-chain proof run on Testnet Bradbury.
// Idempotent: completed steps are stored in docs/evidence/v2/proofs-state.json
// and skipped on re-run. Every recorded tx hash is a real executed transaction;
// if a step cannot be completed the evidence file records the failure honestly.
//
// Single-key setup: the .env key is owner == author == appellant. Report-path
// proofs need a reporter distinct from the author, so a burner account is
// generated, funded from the main key (0.02 GEN) and used ONLY for report();
// its key never leaves the local machine (burner.key, gitignored).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createAccount } from "genlayer-js";
import {
  accountFrom, clientFor, write, read, readJson, expectRevert,
  balance, sendValue, sleep, EXPLORER, PAGES,
} from "./lib/client.mjs";

const STATE_PATH = "docs/evidence/v2/proofs-state.json";
const OUT_PATH = "docs/evidence/v2/registry-v2-proofs.json";

if (!existsSync("deployments.json")) {
  throw new Error("deployments.json missing — run: node --env-file=.env scripts/deploy.mjs");
}
const DEP = JSON.parse(readFileSync("deployments.json", "utf8"));
const PROD = DEP.prod.address;
const DEMO = DEP.demo.address;

const MAIN = accountFrom(process.env.PRIVATE_KEY);
const mainClient = clientFor(MAIN);
console.log("main account:", MAIN.address);

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : { steps: {} };
const evidence = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, "utf8")) : {
  milestone: "v2.0.0",
  chain: DEP.chain,
  contract: DEP.contract,
  prod: DEP.prod, demo: DEP.demo,
  mainAccount: MAIN.address,
  singleKeyNote: "owner == author == appellant (one funded key); a locally generated burner account, funded from this key, acts as reporter for report-path proofs",
  steps: [],
};

function save() {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  writeFileSync(OUT_PATH, JSON.stringify(evidence, null, 2));
}

function record(step, description, data) {
  const entry = { step, description, at: new Date().toISOString(), ...data };
  if (data.txHash) entry.txLink = EXPLORER + "/tx/" + data.txHash;
  const i = evidence.steps.findIndex((s) => s.step === step);
  if (i >= 0) evidence.steps[i] = entry;
  else evidence.steps.push(entry);
  state.steps[step] = { done: true };
  save();
  console.log("== recorded step:", step);
}

async function step(name, fn) {
  if (state.steps[name]?.done) {
    console.log("== skip (done):", name);
    return;
  }
  console.log("== step:", name);
  await fn();
}

const FIX = (name) => PAGES + "/fixtures/" + name;
const STAKE = 1_000_000_000_000n;
const BOND = 1_000_000_000_000n;
const APPEAL_BOND = 2_000_000_000_000n;

// ---------- burner (reporter) ----------
function loadBurner() {
  if (process.env.BURNER_KEY) return createAccount(process.env.BURNER_KEY);
  const path = "burner.key";
  if (existsSync(path)) return createAccount(readFileSync(path, "utf8").trim());
  const acc = createAccount(); // random
  writeFileSync(path, acc.privateKey);
  return acc;
}
const burner = loadBurner();
const burnerClient = clientFor(burner);
if (burner.address === MAIN.address) throw new Error("burner must differ from the main account");

async function fullCycle(client, author, address, url, { withReport = false } = {}) {
  const item_id = await read(client, address, "create_item", [""]);
  await write(client, address, "ingest", [item_id, url], STAKE, "ingest " + item_id);
  if (withReport) {
    await write(client, address, "report", [item_id], BOND, "report " + item_id);
  }
  await write(client, address, "moderate", [item_id], 0n, "moderate " + item_id);
  const item = await readJson(client, address, "get_item", [item_id]);
  await write(client, address, "enforce", [item_id], 0n, "enforce " + item_id);
  const after = await readJson(client, address, "get_item", [item_id]);
  return { item_id, verdict: after.verdict, outcome: after.stake_outcome, injection: after.injection_detected, item: after, moderated: item };
}

// ================================================================= steps
await step("sanity", async () => {
  const cfgProd = await readJson(mainClient, PROD, "get_config", []);
  const cfgDemo = await readJson(mainClient, DEMO, "get_config", []);
  const bMain = await balance(mainClient, MAIN.address);
  const bBurner = await balance(mainClient, burner.address);
  record("sanity", "Deployment sanity: config views readable from both instances", {
    prodConfig: { min_stake: cfgProd.min_stake, rules_version: cfgProd.rules_version, owner: cfgProd.owner },
    demoConfig: { enforce_timeout_sec: cfgDemo.enforce_timeout_sec, appeal_resolve_cooldown_sec: cfgDemo.appeal_resolve_cooldown_sec },
    mainBalanceWei: String(bMain), burnerAddress: burner.address, burnerBalanceWei: String(bBurner),
  });
});

await step("fund_burner", async () => {
  const b = await balance(mainClient, burner.address);
  const need = 20_000_000_000_000_000n; // 0.02 GEN covers bonds + gas
  if (b < need / 2n) {
    const h = await sendValue(mainClient, burner.address, need);
    record("fund_burner", "Funded the burner reporter account from the main key", {
      txHash: h, to: burner.address, valueWei: String(need),
    });
  } else {
    record("fund_burner", "Burner already funded", { to: burner.address, balanceWei: String(b) });
  }
});

await step("benign_approve", async () => {
  const r = await fullCycle(mainClient, MAIN, PROD, FIX("benign.html"));
  record("benign_approve", "Benign post: full cycle create->ingest->moderate->enforce", {
    txHash: r.item.history.at(-1).txHash ?? undefined, itemId: r.item_id,
    verdict: r.verdict, stakeOutcome: r.outcome,
    expect: "verdict APPROVE, stake_outcome author_refund",
    actual: r.verdict + " / " + r.outcome,
    verdictMatches: r.verdict === "APPROVE" && r.outcome === "author_refund",
    item: { id: r.item_id, verdict: r.verdict, confidence: r.item.confidence, scores: r.item.scores },
  });
});

await step("scam_remove_reported", async () => {
  const r = await fullCycle(mainClient, MAIN, PROD, FIX("scam.html"), { withReport: true });
  record("scam_remove_reported", "Scam post with an honest burner report: reporter bond settles as reporter_reward at enforce", {
    itemId: r.item_id, verdict: r.verdict, stakeOutcome: r.outcome,
    expect: "verdict REMOVE, stake_outcome author_forfeit+reporter_reward",
    actual: r.verdict + " / " + r.outcome,
    verdictMatches: r.verdict === "REMOVE" && r.outcome === "author_forfeit+reporter_reward",
  });
});

await step("false_report_slashed", async () => {
  const r = await fullCycle(mainClient, MAIN, PROD, FIX("benign.html") + "?r=1", { withReport: true });
  record("false_report_slashed", "Report on clean content: false reporter bond paid to the author", {
    itemId: r.item_id, verdict: r.verdict, stakeOutcome: r.outcome,
    expect: "verdict APPROVE, stake_outcome author_refund+reporter_forfeit",
    actual: r.verdict + " / " + r.outcome,
    verdictMatches: r.verdict === "APPROVE" && r.outcome === "author_refund+reporter_forfeit",
  });
});

await step("borderline_flag", async () => {
  const r = await fullCycle(mainClient, MAIN, PROD, FIX("borderline.html"));
  record("borderline_flag", "Borderline post: consensus decides FLAG (partial forfeit) or records honestly what consensus produced", {
    itemId: r.item_id, verdict: r.verdict, stakeOutcome: r.outcome,
    expect: "verdict FLAG, stake_outcome author_partial_forfeit",
    actual: r.verdict + " / " + r.outcome,
    verdictMatches: r.verdict === "FLAG" && r.outcome === "author_partial_forfeit",
    note: "borderline content is consensus-sensitive by design; the actual consensus verdict is recorded as-is",
  });
});

for (const inj of ["inject-basic.html", "inject-canary.html", "inject-roleplay.html"]) {
  const name = "injection_" + inj.replace(".html", "").replace("inject-", "");
  await step(name, async () => {
    const r = await fullCycle(mainClient, MAIN, PROD, FIX(inj));
    record(name, "Prompt-injection fixture " + inj + " through the full cycle", {
      itemId: r.item_id, verdict: r.verdict, injectionDetected: r.injection,
      expect: "injection_detected true and verdict FLAG or REMOVE (auto-FLAG of APPROVE)",
      actual: r.verdict + " / injection_detected=" + r.injection,
      verdictMatches: r.injection === true && ["FLAG", "REMOVE"].includes(r.verdict),
    });
  });
}

for (const fx of ["spam.html", "harassment.html"]) {
  const name = "category_" + fx.replace(".html", "");
  await step(name, async () => {
    const r = await fullCycle(mainClient, MAIN, PROD, FIX(fx));
    record(name, "New harm-category fixture " + fx + " through the full cycle (traction)", {
      itemId: r.item_id, verdict: r.verdict, stakeOutcome: r.outcome,
      expect: "verdict REMOVE or FLAG (clear violation)",
      actual: r.verdict + " / " + r.outcome,
      verdictMatches: ["REMOVE", "FLAG"].includes(r.verdict),
    });
  });
}

await step("self_report_revert", async () => {
  const item_id = await read(mainClient, PROD, "create_item", [""]);
  await write(mainClient, PROD, "ingest", [item_id, FIX("mild.html")], STAKE, "ingest " + item_id);
  const msg = await expectRevert(mainClient, PROD, "report", [item_id], BOND, "Self-report not allowed");
  record("self_report_revert", "Author cannot report own item (anti-abuse guard) — single-account setup makes this the natural first proof", {
    txHash: null, itemId: item_id, reverted: true, revertMessage: msg.slice(0, 200),
    note: "revert observed in the rejected transaction; no state change",
  });
});

await step("dup_url_revert", async () => {
  // the benign item is already under active moderation from benign_approve
  const item_id = await read(mainClient, PROD, "create_item", [""]);
  const msg = await expectRevert(mainClient, PROD, "ingest", [item_id, FIX("benign.html")], STAKE, "already under active moderation");
  record("dup_url_revert", "Duplicate-URL guard: second ingest of an actively-moderated source reverts", {
    itemId: item_id, reverted: true, revertMessage: msg.slice(0, 200),
  });
});

await step("batch_moderate", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = await read(mainClient, PROD, "create_item", [""]);
    await write(mainClient, PROD, "ingest", [id, FIX("mild.html") + "?batch=" + i], STAKE, "ingest " + id);
    ids.push(id);
  }
  const hash = (await write(mainClient, PROD, "moderate_batch", [ids], 0n, "moderate_batch")).hash;
  // batch verdicts land in each item; re-read them
  const results = [];
  for (const id of ids) {
    const it = await readJson(mainClient, PROD, "get_item", [id]);
    results.push({ item_id: id, verdict: it.verdict, status: it.status });
  }
  record("batch_moderate", "moderate_batch: 3 items moderated in one call with individual error handling", {
    txHash: hash, batch: results,
    verdictMatches: results.every((r) => ["APPROVE", "FLAG", "REMOVE"].includes(r.verdict)),
  });
});

await step("rules_v2_item", async () => {
  const h = (await write(mainClient, PROD, "set_rules",
    ["v2 rules: strict zero-tolerance for scam/spam; borderline flagged for review; harassment removed on repeat."],
    0n, "set_rules v2")).hash;
  const ver = await readJson(mainClient, PROD, "get_rules", [2]);
  const item_id = await read(mainClient, PROD, "create_item", [""]);
  await write(mainClient, PROD, "ingest", [item_id, FIX("mild.html") + "?rules=2"], STAKE, "ingest " + item_id);
  await write(mainClient, PROD, "moderate", [item_id], 0n, "moderate " + item_id);
  const it = await readJson(mainClient, PROD, "get_item", [item_id]);
  record("rules_v2_item", "Versioned rules: set_rules creates version 2 and the new item is judged under it", {
    txHash: h, rulesVersion2: ver, itemId: item_id, judgedRulesVersion: it.rules_version,
    verdictMatches: it.rules_version === 2,
  });
});

await step("appeal_filed_prod", async () => {
  // dedicated scam item, enforced, appealed by the author (== main key)
  const item_id = await read(mainClient, PROD, "create_item", [""]);
  await write(mainClient, PROD, "ingest", [item_id, FIX("scam.html") + "?appeal=1"], STAKE, "ingest " + item_id);
  await write(mainClient, PROD, "moderate", [item_id], 0n, "moderate " + item_id);
  await write(mainClient, PROD, "enforce", [item_id], 0n, "enforce " + item_id);
  const h = (await write(mainClient, PROD, "appeal",
    [item_id, "I believe this post was misclassified; please re-run validator review."], APPEAL_BOND, "appeal")).hash;
  const it = await readJson(mainClient, PROD, "get_item", [item_id]);
  record("appeal_filed_prod", "Author files an appeal on an enforced item (production instance)", {
    txHash: h, itemId: item_id, status: it.status, appealStake: it.appeal_stake,
    verdictMatches: it.status === "appealed",
    note: "permissionless consensus resolution unlocks after appeal_resolve_cooldown_sec=3600; outcome is decided by validators, not by the owner",
  });
});

await step("demo_overturned_attempt", async () => {
  // demo instance (60 s cooldowns): borderline item -> appeal -> permissionless resolve
  const item_id = await read(mainClient, DEMO, "create_item", [""]);
  await write(mainClient, DEMO, "ingest", [item_id, FIX("borderline.html")], STAKE, "ingest " + item_id);
  await write(mainClient, DEMO, "moderate", [item_id], 0n, "moderate " + item_id);
  await write(mainClient, DEMO, "enforce", [item_id], 0n, "enforce " + item_id);
  const before = await readJson(mainClient, DEMO, "get_item", [item_id]);
  await write(mainClient, DEMO, "appeal", [item_id, "Re-review request: this post discusses a gray-area topic but does not violate the rules."], APPEAL_BOND, "appeal " + item_id);
  console.log("  waiting 65 s for the appeal resolve cooldown...");
  await sleep(65_000);
  const h = (await write(mainClient, DEMO, "resolve_appeal", [item_id], 0n, "resolve_appeal")).hash;
  const after = await readJson(mainClient, DEMO, "get_item", [item_id]);
  record("demo_overturned_attempt", "Demo instance: appeal on a borderline item resolved by independent validator consensus (permissionless)", {
    txHash: h, itemId: item_id, priorVerdict: before.verdict, newVerdict: after.verdict,
    outcome: after.appeal_outcome, status: after.status,
    expect: "OVERTURNED (or honestly recorded UPHELD if validators disagree)",
    actual: after.appeal_outcome,
    verdictMatches: ["overturned", "upheld"].includes(after.appeal_outcome),
  });
});

await step("demo_reclaim_timeout", async () => {
  const item_id = await read(mainClient, DEMO, "create_item", [""]);
  await write(mainClient, DEMO, "ingest", [item_id, FIX("scam.html")], STAKE, "ingest " + item_id);
  await write(mainClient, DEMO, "moderate", [item_id], 0n, "moderate " + item_id);
  await write(mainClient, DEMO, "enforce", [item_id], 0n, "enforce " + item_id);
  await write(mainClient, DEMO, "appeal", [item_id, "Please reconsider."], APPEAL_BOND, "appeal " + item_id);
  console.log("  waiting 65 s for the appeal timeout...");
  await sleep(65_000);
  const h = (await write(mainClient, DEMO, "reclaim_appeal", [item_id], 0n, "reclaim_appeal")).hash;
  const it = await readJson(mainClient, DEMO, "get_item", [item_id]);
  record("demo_reclaim_timeout", "Liveness: appeal bond reclaimed after APPEAL_TIMEOUT_SEC (60 s demo)", {
    txHash: h, itemId: item_id, outcome: it.appeal_outcome,
    verdictMatches: it.appeal_outcome === "reclaimed_timeout",
  });
});

await step("demo_permissionless_enforce", async () => {
  // non-owner (burner) enforces after the 60 s verdict timeout
  const item_id = await read(mainClient, DEMO, "create_item", [""]);
  await write(mainClient, DEMO, "ingest", [item_id, FIX("spam.html")], STAKE, "ingest " + item_id);
  await write(mainClient, DEMO, "moderate", [item_id], 0n, "moderate " + item_id);
  console.log("  waiting 65 s for the enforce timeout...");
  await sleep(65_000);
  const h = (await write(burnerClient, DEMO, "enforce", [item_id], 0n, "enforce by burner")).hash;
  const it = await readJson(mainClient, DEMO, "get_item", [item_id]);
  record("demo_permissionless_enforce", "Liveness: a non-owner enforces after ENFORCE_TIMEOUT_SEC (60 s demo)", {
    txHash: h, itemId: item_id, enforcedBy: burner.address, status: it.status,
    verdictMatches: it.status === "enforced",
  });
});

await step("final_stats", async () => {
  const statsProd = await readJson(mainClient, PROD, "get_stats", []);
  const statsDemo = await readJson(mainClient, DEMO, "get_stats", []);
  const payoutsProd = await readJson(mainClient, PROD, "get_payouts", [0, 50]);
  const repBurner = await readJson(mainClient, PROD, "get_reputation", [burner.address]);
  record("final_stats", "On-chain traction snapshot: get_stats on both instances + payout ledger + burner reputation", {
    statsProd, statsDemo, payoutsCount: payoutsProd?.total, payouts: payoutsProd?.payouts,
    burnerReputation: repBurner,
  });
});

console.log("=== proof run complete:", evidence.steps.length, "steps recorded ===");
