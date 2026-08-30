# Changelog

All notable changes to **ContentModerator**. Commit links point to the repository history.

## [v1.2] — 2026-08-30 — Economic hardening (minimal surgical state-machine patches) — tag `v1.2.0`

Redeployed to Bradbury `0x62A9196dBB55585840D13631aB7C68288761a74A` — deploy tx [`0x3f93bb95`](https://explorer-bradbury.genlayer.com/tx/0x3f93bb9574627afdc0bd41caa79e0b8e329004b7098915ad0c9de61db0425c47). No architecture, consensus, or ingest changes; `registry.html` only had its contract-address pointer repointed.

### Fixed
- **Re-roll gate** — `moderate()` on a `moderated` item now requires owner OR an active report (plus an LLM cooldown); a non-owner re-roll reverts. Proof: [`0x4d9a2449`](https://explorer-bradbury.genlayer.com/tx/0x4d9a2449fbef3f73c18282c12a99313e5c8b404ec5c62708e76eb52e4092669b).
- **Reporter bond no longer strands** — `report()` dropped `enforced` from the reportable set, so no bond can be locked against an enforced item. Proof (revert): [`0x23163f4d`](https://explorer-bradbury.genlayer.com/tx/0x23163f4d42de22c04ad6fba197133ace0204107fc3b185f036153ed5fc91b4eb).
- **Report path proven live (positive)** — an honest reporter bonds on an `ingested` item and the bond settles deterministically at `enforce()`: report [`0xc6083bf7`](https://explorer-bradbury.genlayer.com/tx/0xc6083bf770a88b706fe45275ade4212f065de72d817aff94c86e988d21977446) → moderate [`0xe4f62b8a`](https://explorer-bradbury.genlayer.com/tx/0xe4f62b8ae0f60b18cef1b2de7314dad72facb73fb68ec74a9189f93de5fc46aa) → enforce [`0xdb846b83`](https://explorer-bradbury.genlayer.com/tx/0xdb846b83f65102333732b41d1dc4a1d86943d1160c0d3ccad2d2072f4a6daf07), settling `author_refund+reporter_forfeit` (false report slashed, paid to author).
- **Duplicate-URL ingest guard (T1)** — a second ingest of a URL already under active moderation reverts before any stake or fetch. Live (revert): [`0xc0a74b6a`](https://explorer-bradbury.genlayer.com/tx/0xc0a74b6a07006a6323839538fde4a12ac85437adb2f594292c351cb9c4c6a0cd).

### Added
- **Liveness by timeout** — permissionless `enforce()` after `ENFORCE_TIMEOUT_SEC` (86400 s) and `reclaim_appeal()` after `APPEAL_TIMEOUT_SEC` (172800 s). Positive proofs on a 60 s-constant demo instance `0xf481F23BAb92117d0C424a7cCB047c78B17471B2`: enforce [`0xf12ed266`](https://explorer-bradbury.genlayer.com/tx/0xf12ed266f0777bb0a0d4e09b783e55d0bfda7c61403af2f37d3281d18c94cab0), reclaim [`0x34df52e8`](https://explorer-bradbury.genlayer.com/tx/0x34df52e8d08e4018d8188db8414db1287ba0d8cea664c2f95456794d8a51a88d).
- **Per-call canary token** (`_canary_token`) replacing the static `GLM-OK`, closing the public-canary-echo bypass.
- **Public content masking** (`_public_item`) — REMOVE returns `[content removed by moderation]`, FLAG is prefixed `[limited]`.
- **Reachable second appeal** — removed the per-item `appeal_count<2` cap; appeals stay reachable (denied → `enforced`), each costs a fresh bond, an overturned item is terminal.

### Evidence
- `registry-v12-proofs.json` (guard reverts), `registry-demo-evidence.json` (timeout positives), `registry-v12-tests.json` (fix suite), `registry-v12-reportpath.json` (report-path positives + T1 dedup).

## [v1.1] — 2026-08-29 — Multi-item Registry, Staking & Anti-abuse

### Security
- Documented the full threat model in `SECURITY.md` (attack -> cost -> defense matrix mapped to `contracts/registry.py` line references) — [2472e8b](https://github.com/Artem1981777/genlayer-content-moderator/commit/2472e8b)
- Prompt-injection hardening and an explicit `injection_attempt` harm axis with auto-FLAG on detected injection — [f73005c](https://github.com/Artem1981777/genlayer-content-moderator/commit/f73005c)

### Architecture
- Added `ARCHITECTURE.md`: mermaid item-lifecycle state machine, state-transition table, consensus sequence diagram, and stake-economics matrix — [e00a7fc](https://github.com/Artem1981777/genlayer-content-moderator/commit/e00a7fc)
- Tolerant comparative-consensus rationale so borderline content resolves without brittle exact-match consensus — [f73005c](https://github.com/Artem1981777/genlayer-content-moderator/commit/f73005c)

### New functionality
- Anti-abuse guards: self-report ban, per-address caps on open reports and appeals, and false-reporter slashing — [f73005c](https://github.com/Artem1981777/genlayer-content-moderator/commit/f73005c)
- Staking economy: author stake / reporter bond / appeal bond, forfeit/reward/refund settlement, and an on-chain payout ledger (`get_payouts`)

### New deployment
- Deployed registry **v1.1** to Bradbury `0x20f6e32560427094aC913Da6e900c0b4899AE41A`, repointed the dApp, left v0.5.0 (`0x235F51...`) untouched — [f771d18](https://github.com/Artem1981777/genlayer-content-moderator/commit/f771d18)

### Traction
- Pre-seeded registry v1.1 across APPROVE/REMOVE verdicts, both slashing directions, and a completed appeal — [8bfcc09](https://github.com/Artem1981777/genlayer-content-moderator/commit/8bfcc09), [41ddc9e](https://github.com/Artem1981777/genlayer-content-moderator/commit/41ddc9e)
- Moderation fixtures for seeding — [8adee88](https://github.com/Artem1981777/genlayer-content-moderator/commit/8adee88), [9bbb6f6](https://github.com/Artem1981777/genlayer-content-moderator/commit/9bbb6f6)

### dApp (major feature)
- Mission-control dashboard: one-click Judge/Steward guided cycles, RPC-retry on transient errors, input validation, and post-transaction status reread with Explorer links — [bd0148c](https://github.com/Artem1981777/genlayer-content-moderator/commit/bd0148c)
- Mission-control dashboard: 3-zone layout, vertical stepper, radar/gauge charts, KPI sparklines, network-health, activity timeline, items grid + payout ledger — [7da73ab](https://github.com/Artem1981777/genlayer-content-moderator/commit/7da73ab)
- Restore visible matrix background — [7bfe6f3](https://github.com/Artem1981777/genlayer-content-moderator/commit/7bfe6f3)
- Production dApp redesign: onboarding, 7-axis item modal, selector, toasts, tooltips, confirm modals, tx feed — [c4d78a1](https://github.com/Artem1981777/genlayer-content-moderator/commit/c4d78a1)
- Live tx activity feed + prefilled fields — [c8582df](https://github.com/Artem1981777/genlayer-content-moderator/commit/c8582df); poll `get_item_ids` for the new id on create — [77e037e](https://github.com/Artem1981777/genlayer-content-moderator/commit/77e037e)
- Network guard (auto-select/add Bradbury, block wrong-chain tx) — [8955871](https://github.com/Artem1981777/genlayer-content-moderator/commit/8955871); multi-wallet EIP-6963 — [afb24f6](https://github.com/Artem1981777/genlayer-content-moderator/commit/afb24f6)

## [v0.6.0] — multi-axis verdict + severity + injection flag, staked appeals (`fund_pool`/`appeal`/`resolve`), resilient E2E — [ee6427c](https://github.com/Artem1981777/genlayer-content-moderator/commit/ee6427c)
## [v0.5.0] — authenticated ingestion (fetched source + signed author), `reverify_source`, two-role E2E — [e73c9ff](https://github.com/Artem1981777/genlayer-content-moderator/commit/e73c9ff)
## [v0.4.0] — verifiable content record + enforcement/appeal workflow — [5fe5a5d](https://github.com/Artem1981777/genlayer-content-moderator/commit/5fe5a5d)
## [v0.3.0] — self-calibrating moderation (confidence, auto-escalation, categories) — [3a2e424](https://github.com/Artem1981777/genlayer-content-moderator/commit/3a2e424)
## [v0.2.0] — on-chain appeals workflow (appeal + re-moderation + history) — [b32d56c](https://github.com/Artem1981777/genlayer-content-moderator/commit/b32d56c)
## [v0.1.0] — initial ContentModerator Intelligent Contract — [f75b3f3](https://github.com/Artem1981777/genlayer-content-moderator/commit/f75b3f3)
