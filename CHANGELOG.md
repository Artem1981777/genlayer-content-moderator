# Changelog

All notable changes to **ContentModerator**. Commit links point to the repository history.

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
