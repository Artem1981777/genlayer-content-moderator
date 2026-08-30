import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
const v11="0x20f6e32560427094aC913Da6e900c0b4899AE41A";
const v12="0x62A9196dBB55585840D13631aB7C68288761a74A";

const HARDENING=[
 "### Economic hardening (v1.2.0)",
 "",
 "v1.2.0 is a minimal, surgical hardening of the v1.1 state machine — no architecture, consensus, ingest, or dApp-logic changes. Redeployed to Bradbury as `0x62A9196dBB55585840D13631aB7C68288761a74A` (deploy tx [`0x3f93bb95`](https://explorer-bradbury.genlayer.com/tx/0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47)).",
 "",
 "| Hardening | Guarantee | Live proof (Bradbury) |",
 "| --- | --- | --- |",
 "| Re-roll gate on `moderate()` | a moderated verdict cannot be re-rolled by a non-owner without an active report | reverted re-roll [`0x4d9a2449`](https://explorer-bradbury.genlayer.com/tx/0x4d9a2449fbef3f73c18282c12a99313e5c8b404ec5c62708e76eb52e4092669b) |",
 "| `report()` excludes `enforced` | a reporter bond can no longer be stranded on an already-enforced item | reverted report-on-enforced [`0x23163f4d`](https://explorer-bradbury.genlayer.com/tx/0x23163f4d42de22c04ad6fba197133ace0204107fc3b185f036153ed5fc91b4eb) |",
 "| permissionless `enforce()` after `ENFORCE_TIMEOUT_SEC` | staked value cannot be frozen by an inactive owner | permissionless enforce [`0xf12ed266`](https://explorer-bradbury.genlayer.com/tx/0xf12ed266f0777bb0a0d4e09b783e55d0bfda7c61403af2f37d3281d18c94cab0) |",
 "| `reclaim_appeal()` after `APPEAL_TIMEOUT_SEC` | an appellant always recovers the bond if the owner never resolves | reclaim by timeout [`0x34df52e8`](https://explorer-bradbury.genlayer.com/tx/0x34df52e8d08e4018d8188db8414db1287ba0d8cea664c2f95456794d8a51a88d) |",
 "| per-call canary token (`_canary_token`) | a leaked static canary can no longer be echoed to bypass injection detection | SECURITY.md #6 |",
 "| masked public content (`_public_item`) | blocked/limited content is not re-served via `get_item`/`get_all_items` | SECURITY.md #4 |",
 "",
 "Both timeout proofs were produced on a dedicated demo instance `0xf481F23BAb92117d0C424a7cCB047c78B17471B2` with shortened constants (`ENFORCE_TIMEOUT_SEC=APPEAL_TIMEOUT_SEC=60`), so the permissionless paths are verifiable without waiting the production 24h/48h windows; production v1.2 keeps 86400/172800 s. Raw evidence: `registry-demo-evidence.json`, `registry-v12-proofs.json`.",
 "",
 "",
].join("\n");

const CHANGELOG=[
 "## [v1.2] — 2026-08-30 — Economic hardening (minimal surgical state-machine patches) — tag `v1.2.0`",
 "",
 "Redeployed to Bradbury `0x62A9196dBB55585840D13631aB7C68288761a74A` — deploy tx [`0x3f93bb95`](https://explorer-bradbury.genlayer.com/tx/0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47). No architecture, consensus, or ingest changes; `registry.html` only had its contract-address pointer repointed.",
 "",
 "### Fixed",
 "- **Re-roll gate** — `moderate()` on a `moderated` item now requires owner OR an active report (plus an LLM cooldown); a non-owner re-roll reverts. Proof: [`0x4d9a2449`](https://explorer-bradbury.genlayer.com/tx/0x4d9a2449fbef3f73c18282c12a99313e5c8b404ec5c62708e76eb52e4092669b).",
 "- **Reporter bond no longer strands** — `report()` dropped `enforced` from the reportable set, so no bond can be locked against an enforced item. Proof (revert): [`0x23163f4d`](https://explorer-bradbury.genlayer.com/tx/0x23163f4d42de22c04ad6fba197133ace0204107fc3b185f036153ed5fc91b4eb).",
 "",
 "### Added",
 "- **Liveness by timeout** — permissionless `enforce()` after `ENFORCE_TIMEOUT_SEC` (86400 s) and `reclaim_appeal()` after `APPEAL_TIMEOUT_SEC` (172800 s). Positive proofs on a 60 s-constant demo instance `0xf481F23BAb92117d0C424a7cCB047c78B17471B2`: enforce [`0xf12ed266`](https://explorer-bradbury.genlayer.com/tx/0xf12ed266f0777bb0a0d4e09b783e55d0bfda7c61403af2f37d3281d18c94cab0), reclaim [`0x34df52e8`](https://explorer-bradbury.genlayer.com/tx/0x34df52e8d08e4018d8188db8414db1287ba0d8cea664c2f95456794d8a51a88d).",
 "- **Per-call canary token** (`_canary_token`) replacing the static `GLM-OK`, closing the public-canary-echo bypass.",
 "- **Public content masking** (`_public_item`) — REMOVE returns `[content removed by moderation]`, FLAG is prefixed `[limited]`.",
 "- **Reachable second appeal** — removed the per-item `appeal_count<2` cap; appeals stay reachable (denied → `enforced`), each costs a fresh bond, an overturned item is terminal.",
 "",
 "### Evidence",
 "- `registry-v12-proofs.json` (guard reverts), `registry-demo-evidence.json` (timeout positives), `registry-v12-tests.json` (fix suite).",
 "",
 "",
].join("\n");

const edits=[
 {file:"registry.html", old:'const REGISTRY = "'+v11+'";', new:'const REGISTRY = "'+v12+'";'},
 {file:"README.md", old:"badge/registry-v1.1-brightgreen", new:"badge/registry-v1.2-brightgreen"},
 {file:"README.md", old:"address/"+v11, new:"address/"+v12},
 {file:"README.md", old:"| v1.1 | `"+v11+"` | active (registry + anti-abuse) |", new:"| v1.2 | `"+v12+"` | active (economic hardening) |\n| v1.1 | `"+v11+"` | history (registry + anti-abuse) |"},
 {file:"README.md", old:"- Deploy tx v1.1: `0x1f65dd8891624386b1bd32bbd3b840964bb248b862715fe786a7c343d1d3840a`", new:"- Deploy tx v1.2: `0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47`\n- Deploy tx v1.1: `0x1f65dd8891624386b1bd32bbd3b840964bb248b862715fe786a7c343d1d3840a`"},
 {file:"README.md", old:"### On-chain traction (registry v1.1)", new:HARDENING+"### On-chain traction (registry v1.1)"},
 {file:"README.md", old:"### v1.1 Intelligent Contract", new:"### Intelligent Contract (v1.2 active, lineage from v1.1)"},
 {file:"CHANGELOG.md", old:"## [v1.1] — 2026-08-29 — Multi-item Registry, Staking & Anti-abuse", new:CHANGELOG+"## [v1.1] — 2026-08-29 — Multi-item Registry, Staking & Anti-abuse"},
];

const files={};
for(const e of edits){ if(!(e.file in files)) files[e.file]=readFileSync(e.file,"utf8"); }
let failed=0; const report=[];
for(const e of edits){
  const c=files[e.file];
  const n=c.split(e.old).length-1;
  if(n!==1){ failed++; report.push("FAIL x"+n+"  ["+e.file+"]  anchor: "+e.old.slice(0,64)); continue; }
  files[e.file]=c.replace(e.old,e.new);
  report.push("ok        ["+e.file+"]  "+e.old.slice(0,54));
}
console.log(report.join("\n"));
if(failed>0){ console.log("=== "+failed+" EDIT(S) FAILED — NO FILES WRITTEN ==="); process.exit(1); }
for(const f of Object.keys(files)){ if(!existsSync(f+".v12bak")) copyFileSync(f,f+".v12bak"); writeFileSync(f,files[f]); console.log("wrote "+f); }
console.log("=== ALL EDITS OK ===");
