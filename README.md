# ContentModerator — AI Content Moderation on GenLayer

[![GenLayer](https://img.shields.io/badge/GenLayer-Bradbury%20testnet-6c5ce7)](https://explorer-bradbury.genlayer.com/address/0x62A9196dBB55585840D13631aB7C68288761a74A) [![Live dApp](https://img.shields.io/badge/live-dApp-00b894)](https://artem1981777.github.io/genlayer-content-moderator/registry.html) [![Registry](https://img.shields.io/badge/registry-v1.2-brightgreen)](CHANGELOG.md) [![Intelligent Contract](https://img.shields.io/badge/Intelligent%20Contract-Python-3776ab)](contracts/registry.py)

> Decentralized content moderation as a GenLayer Intelligent Contract — on-chain community rules, validator-run LLM verdicts finalized by comparative consensus, staking & appeals, and a full on-chain audit trail.

📚 Deep dives: [Security model](SECURITY.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

ContentModerator is a GenLayer Intelligent Contract that moderates user-generated content through validator consensus instead of a single trusted moderator. Community rules live on-chain; each decision is produced by an LLM run by every validator and finalized by comparative consensus, with a full on-chain audit trail.

**Live dApp:** https://artem1981777.github.io/genlayer-content-moderator/registry.html

## Contents

- [Milestone v1 — what's new since v0.5.0](#milestone-v1--multi-item-registry-staking--anti-abuse-whats-new-since-v050)
- [Deployments](#deployments-bradbury-testnet)
- [On-chain traction](#on-chain-traction-registry-v11)
- [v0.5.0 — authenticated ingestion](#v050--authenticated-ingestion-what-changed)
- [Lifecycle](#lifecycle)
- [Live proof](#live-proof-on-genlayer-testnet-bradbury)
- [Security](#security)
- [Documentation & verification](#documentation--verification)
- [Repository layout](#repository-layout)
- [Run](#run)

## Milestone v1 — Multi-item Registry, Staking & Anti-abuse (what's new since v0.5.0)

v0.5.0 moderated a single authenticated item. Milestone v1 turns ContentModerator into a multi-item on-chain registry with a full staking economy, a hardened multi-axis AI prompt, anti-abuse guards, and an interactive dApp. Every consensus-critical decision stays inside the Intelligent Contract; the frontend only reads state and submits transactions.

| What's new | Category | Where |
| --- | --- | --- |
| Multi-item registry (`TreeMap` keyed by `item_id`, paginated `get_all_items`) | major feature | `contracts/registry.py` |
| Staking economy: author stake, reporter bond, appeal bond; forfeit/reward/refund branches; on-chain payout ledger | new functionality | `registry.py` `_settle_stakes` / `get_payouts` |
| Anti-abuse: self-report ban, per-address caps on open reports & appeals, false-reporter slashing | new functionality | `registry.py` `report`/`appeal`/`enforce` (f73005c) |
| Prompt-injection hardening + explicit `injection_attempt` axis with auto-FLAG | security | `registry.py` `_compute_verdict` (f73005c) |
| Tolerant comparative-consensus rationale for borderline content | architecture | `registry.py` (f73005c) |
| Interactive mission-control dApp (radar/gauge, KPI sparklines, network health, live tx feed, multi-wallet) | major feature | `registry.html` (7da73ab) |
| New v1.1 deployment on Bradbury (v0.5.0 left untouched) | new deployment | `0x20f6e325...` (f771d18) |
| Pre-seeded registry across APPROVE/REMOVE, both slashing directions, completed appeal | traction | `seed-registry.mjs` / `finish-seed.mjs` |

### Deployments (Bradbury testnet)

| Version | Address | Status |
| --- | --- | --- |
| v1.2 | `0x62A9196dBB55585840D13631aB7C68288761a74A` | active (economic hardening) |
| v1.1 | `0x20f6e32560427094aC913Da6e900c0b4899AE41A` | history (registry + anti-abuse) |
| v1.0.0 | `0x8F2D6Bf4C1A860E225c36C687c411292fc6c7c5e` | history |
| v0.5.0 | `0x235F51b11b9F96d6673df37553Ef58373c4324F9` | unchanged (approved) |

- Deploy tx v1.2: `0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47`
- Deploy tx v1.1: `0x1f65dd8891624386b1bd32bbd3b840964bb248b862715fe786a7c343d1d3840a`
- Owner / operator: `0x198a1952BD58984281f57CF824d264cdbd412814`
- Author / staker: `0xB596E24480e6a9a54d5303d84791917Bcf8b64D0`

### Economic hardening (v1.2.0)

v1.2.0 is a minimal, surgical hardening of the v1.1 state machine — no architecture, consensus, ingest, or dApp-logic changes. Redeployed to Bradbury as `0x62A9196dBB55585840D13631aB7C68288761a74A` (deploy tx [`0x3f93bb95`](https://explorer-bradbury.genlayer.com/tx/0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47)).

| Hardening | Guarantee | Live proof (Bradbury) |
| --- | --- | --- |
| Re-roll gate on `moderate()` | a moderated verdict cannot be re-rolled by a non-owner without an active report | reverted re-roll [`0x4d9a2449`](https://explorer-bradbury.genlayer.com/tx/0x4d9a2449fbef3f73c18282c12a99313e5c8b404ec5c62708e76eb52e4092669b) |
| `report()` excludes `enforced` | a reporter bond can no longer be stranded on an already-enforced item | reverted report-on-enforced [`0x23163f4d`](https://explorer-bradbury.genlayer.com/tx/0x23163f4d42de22c04ad6fba197133ace0204107fc3b185f036153ed5fc91b4eb) |
| `report()` opens on `ingested` (positive) | an honest reporter can bond against live content | report opened [`0xc6083bf7`](https://explorer-bradbury.genlayer.com/tx/0xc6083bf770a88b706fe45275ade4212f065de72d817aff94c86e988d21977446) |
| reporter bond settles at `enforce()` | a false report is slashed and paid to the author (`author_refund+reporter_forfeit`) | moderate [`0xe4f62b8a`](https://explorer-bradbury.genlayer.com/tx/0xe4f62b8ae0f60b18cef1b2de7314dad72facb73fb68ec74a9189f93de5fc46aa) → enforce [`0xdb846b83`](https://explorer-bradbury.genlayer.com/tx/0xdb846b83f65102333732b41d1dc4a1d86943d1160c0d3ccad2d2072f4a6daf07) |
| duplicate-URL ingest guard (T1) | the same source cannot be double-staked while under active moderation | reverted dup ingest [`0xc0a74b6a`](https://explorer-bradbury.genlayer.com/tx/0xc0a74b6a07006a6323839538fde4a12ac85437adb2f594292c351cb9c4c6a0cd) |
| permissionless `enforce()` after `ENFORCE_TIMEOUT_SEC` | staked value cannot be frozen by an inactive owner | permissionless enforce [`0xf12ed266`](https://explorer-bradbury.genlayer.com/tx/0xf12ed266f0777bb0a0d4e09b783e55d0bfda7c61403af2f37d3281d18c94cab0) |
| `reclaim_appeal()` after `APPEAL_TIMEOUT_SEC` | an appellant always recovers the bond if the owner never resolves | reclaim by timeout [`0x34df52e8`](https://explorer-bradbury.genlayer.com/tx/0x34df52e8d08e4018d8188db8414db1287ba0d8cea664c2f95456794d8a51a88d) |
| per-call canary token (`_canary_token`) | a leaked static canary can no longer be echoed to bypass injection detection | SECURITY.md #6 |
| masked public content (`_public_item`) | blocked/limited content is not re-served via `get_item`/`get_all_items` | SECURITY.md #4 |

Both timeout proofs were produced on a dedicated demo instance `0xf481F23BAb92117d0C424a7cCB047c78B17471B2` with shortened constants (`ENFORCE_TIMEOUT_SEC=APPEAL_TIMEOUT_SEC=60`), so the permissionless paths are verifiable without waiting the production 24h/48h windows; production v1.2 keeps 86400/172800 s. Raw evidence: `registry-demo-evidence.json`, `registry-v12-proofs.json`, `registry-v12-reportpath.json`.

### On-chain traction (registry v1.1)

All states are verifiable via `get_all_items` / `get_payouts`. Explorer: https://explorer-bradbury.genlayer.com

| Item id | Verdict | Stake outcome | Demonstrates |
| --- | --- | --- | --- |
| `2511dad838a6b6e9` | APPROVE | author_refund | clean content, stake returned |
| `6955975a56828c88` | REMOVE | author_forfeit | violation, author loses stake |
| `d0a8e44b96f114cd` | APPROVE | author_refund + reporter_forfeit | false-reporter slashing (compensation to author) |
| `3884daf20bdf64dc` | REMOVE (appeal upheld) | author_forfeit + reporter_reward + appeal_forfeit | honest-reporter reward + completed appeal |

Full lifecycle (item `3884daf20bdf64dc`): create `0x3a52f64e...` / ingest `0x8654013d...` / report `0x526bb0dc...` / moderate `0xdde156f6...` / enforce `0x329dd9f9...` / appeal `0xcade26f6...` / resolve_appeal `0x617b94d1...`

Payout ledger (on-chain): `author_refund` 1e12 x2, `false_report_comp` 1e12 to author, `reporter_reward` 1.5e12 to operator.

> Note: the full report → moderate → enforce path is proven live on production v1.2 — report [`0xc6083bf7`](https://explorer-bradbury.genlayer.com/tx/0xc6083bf770a88b706fe45275ade4212f065de72d817aff94c86e988d21977446) then settlement `author_refund+reporter_forfeit` at enforce [`0xdb846b83`](https://explorer-bradbury.genlayer.com/tx/0xdb846b83f65102333732b41d1dc4a1d86943d1160c0d3ccad2d2072f4a6daf07), plus the duplicate-URL guard [`0xc0a74b6a`](https://explorer-bradbury.genlayer.com/tx/0xc0a74b6a07006a6323839538fde4a12ac85437adb2f594292c351cb9c4c6a0cd). The FLAG verdict is fully supported by the contract (top harm-axis 50-79 maps to FLAG); the FLAG-specific `author_partial_forfeit` settlement is intentionally not force-seeded because borderline content is by design consensus-sensitive, and we do not fabricate on-chain results.

## v0.5.0 — authenticated ingestion (what changed)

Earlier versions let the operator supply the item id, source, author and content, and verify_content only re-hashed that operator-supplied text. v0.5.0 makes the moderated record authenticated and non-operator-controlled:

- Content is bound to a fetched platform source. ingest(url) makes the contract itself fetch the live page under validator consensus (gl.nondet.web.render inside gl.eq_principle.prompt_comparative). The operator can no longer type or inject content.
- The record is derived, not chosen: content_hash = sha256(fetched content), item_id = sha256(source url), source = the fetched url.
- The author is bound to a transaction signature: ingest() sets author = gl.message.sender_address, so operator and author are two distinct, cryptographically-authenticated identities.
- The operator overwrite path (old set_content) has been removed entirely.
- reverify_source() re-fetches the live source under consensus and confirms the on-chain record still matches (live authenticity, not just a static hash).

## Lifecycle

created -> pending -> moderated -> enforced -> appealed -> resolved

- ingest(url) — author-signed; fetches and records the authenticated content (created -> pending)
- moderate() — validator consensus produces APPROVE / FLAG / REMOVE (pending -> moderated)
- enforce() — creator-only; REMOVE blocks the item (read_content returns [REMOVED BY CONSENSUS MODERATION]), FLAG limits it (moderated -> enforced)
- appeal(note) — author-only; opens an appeal (enforced -> appealed)
- resolve_appeal() — creator-only; re-runs consensus, sets OVERTURNED or UPHELD (appealed -> resolved)
- reverify_source() — re-fetches the source under consensus, records match=true/false
- read_content(), verify_content(text), get_state() — views

## Live proof on GenLayer Testnet (Bradbury)

Contract v0.5.0: 0x235F51b11b9F96d6673df37553Ef58373c4324F9

Full authenticated run with separate operator and author accounts:

- Operator / creator: 0x198a1952BD58984281f57CF824d264cdbd412814
- Author: 0xB596E24480e6a9a54d5303d84791917Bcf8b64D0

Transactions (explorer https://explorer-bradbury.genlayer.com):

- Deploy: 0x64259ee887518a53e6113802b9acf8c898a9ad7d31c577cee579b32b358da6b7
- Ingest (author, fetched-source authentication): 0x6eaec3df8622bdb8b75ad3dfb3c993b8ab0c1936e87d94c864780d8f91b0166d
- Moderate (consensus REMOVE): 0x804259ded07a85df7f03f903e71ef41f3ad328e147566fa3ee7d142c2734b3fa
- Enforce (blocked): 0x495929b71cde3d002d6d91f9f769bc0ba55a675137f911bd70e59f9815a5cbb4
- Appeal (author): 0x764ae9f00511c7d8b26ce45bb271f0a9db90115e2f2196ec5a46937869afa39f
- Resolve appeal (UPHELD): 0xdab5c49935d6f9cd91d3087be08c6f9e1c11f78713384a7053c9298d443f49e7
- Reverify source (match=true): 0x58d4b8e14036845489968b0392619e4f293d2c01641eb5794cfb74f512ce1d3f

Result: verdict REMOVE (confidence 100), read_content masked, appeal UPHELD, reverify match=true, verify_content(recorded)=true and verify_content(tampered)=false.

Authenticated source fetched in the run:

- Scam post (REMOVE): https://artem1981777.github.io/genlayer-content-moderator/fixtures/scam.html
- Benign post (APPROVE case): https://artem1981777.github.io/genlayer-content-moderator/fixtures/benign.html

## Security

- Fetched content is treated as untrusted data (prompt-injection defense: embedded instructions are judged, never executed).
- Subjective judgement uses eq_principle comparative consensus; malformed model output defaults to FLAG.
- Creator-only enforcement and appeal resolution; author-only appeals; strict state-machine guards.
- Authenticated, immutable record: no operator overwrite path; verify_content and reverify_source provide tamper and live-source checks.

## Documentation & verification

Everything added on top of the approved v0.5.0, in one place — what each artifact does and where to verify it, so reviewers can follow a single page instead of a wall of links.

### Deep-dive docs
- **[SECURITY.md](SECURITY.md)** — threat model: prompt-injection defenses (untrusted-data markers, verbatim-only extraction, explicit `injection_attempt` axis with auto-FLAG), staking / anti-abuse invariants (self-report ban, per-address caps on open reports & appeals, false-reporter slashing), and owner-only enforcement.
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — contract layout and data model (`TreeMap[str,str]` registry keyed by `item_id`, on-chain payout ledger), the moderation lifecycle, and the strict contract/frontend boundary — all consensus-critical logic stays inside the Intelligent Contract.
- **[CHANGELOG.md](CHANGELOG.md)** — every change since v0.5.0 grouped by category (security / architecture / new functionality / new deployment / traction / dApp), each linked to its commit.

### Adversarial / prompt-injection test suite
The contract fetches live web content, so prompt-injection is the primary attack surface. This suite proves the defense end-to-end, on-chain:
- **[adversarial-seed.mjs](adversarial-seed.mjs)** — for each injection fixture it runs the full lifecycle (`create_item` -> `ingest` -> `moderate` -> `enforce`) against the v1.1 registry and asserts the attempt is caught (`injection_detected` true and verdict in {FLAG, REMOVE}). Results are written to `registry-adversarial.json`.
- Live fixtures (served from GitHub Pages — the exact HTML the contract ingests):
  - **[inject-basic.html](https://artem1981777.github.io/genlayer-content-moderator/fixtures/inject-basic.html)** — benign-looking post carrying an inline instruction-override payload ("ignore previous instructions...").
  - **[inject-canary.html](https://artem1981777.github.io/genlayer-content-moderator/fixtures/inject-canary.html)** — attempt to smuggle an override/canary token to force an APPROVE.
  - **[inject-roleplay.html](https://artem1981777.github.io/genlayer-content-moderator/fixtures/inject-roleplay.html)** — roleplay / jailbreak-style prompt trying to escape the moderation instructions.

### Interactive dApp (mission-control)
- **Live:** [registry.html](https://artem1981777.github.io/genlayer-content-moderator/registry.html) · source: **[registry.html](registry.html)**
- One-click **guided cycles** — Judge (create -> ingest -> moderate -> enforce) and Steward (resolve an appealed item) — plus **RPC retry** on transient errors (retries only before broadcast, so no double-send) and a **post-transaction status reread** that surfaces the new item status/verdict. The dApp only reads state and submits transactions; every verdict is computed in the contract.

### Intelligent Contract (v1.2 active, lineage from v1.1)
- **[contracts/registry.py](contracts/registry.py)** — the v1.1 registry (commit [`f73005c`](https://github.com/Artem1981777/genlayer-content-moderator/commit/f73005c)): multi-item registry, staking economy, hardened multi-axis prompt, and anti-abuse guards.

## Repository layout

- contracts/moderator.py — the Intelligent Contract (v0.5.0)
- test.mjs — full two-role end-to-end test (operator + author)
- resume.mjs — idempotent runner that attaches to a deployed contract and drives the remaining steps (congestion-tolerant)
- fixtures/ — public sample posts used as authenticated sources

## Run

    npm i genlayer-js
    node --env-file=.env test.mjs

The operator key (PRIVATE_KEY) is read from .env; the author key is read from a separate local file (never committed). GenLayer Testnet Bradbury: chain id 4221, RPC https://rpc-bradbury.genlayer.com.
