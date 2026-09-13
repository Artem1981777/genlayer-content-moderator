# Milestone v2 — ContentModerator

Baseline: accepted **v1.2** (`contracts/registry.py`, deployed `0x62A9196dBB55585840D13631aB7C68288761a74A`). This milestone is a full v2 rewrite delivered as a monorepo. Every claim links code, tests, or a real transaction (see `docs/evidence/v2/`); anything not yet proven on-chain is marked TODO.

## What changed, by portal category

### Architecture / security — `contracts/registry_v2.py`
| Change | Why it matters | Verify |
|---|---|---|
| JSON-string storage (`TreeMap[str,str]` blobs) replaced by native GenVM structures: `@allow_storage` dataclasses (`Item`, `RuleSet`, `Reputation`, `Payout`, `HistoryEntry`), `TreeMap[str, Item]`, typed indexes, `u64/u256` ints | Type safety, cheaper reads, no silent JSON corruption; nondet blocks read plain copies, per docs | `contracts/registry_v2.py` L90-160; `genvm-lint check` green |
| `gl.eq_principle.prompt_comparative` replaced by explicit `gl.vm.run_nondet_unsafe(leader, validator)`: three-step leader (fetch → extract → decide), validator re-runs it and agrees **by code** (verdict equality, per-axis |Δ| ≤ 15, injection band >50) | Deterministic, auditable consensus instead of an LLM judging equivalence | `registry_v2.py` `_moderation_pass`/`_decisions_agree`; tests `test_moderation.py::test_validator_*` |
| Classified errors `[EXTERNAL]`/`[TRANSIENT]`/`[LLM_ERROR]` + docs `_handle_leader_error` pattern (validator agrees only on the identical classified error) | Fetch failures no longer become empty content; consensus on errors instead of swallowing | `_fetch_page`, `_handle_leader_error`; `test_fetch_unavailable_external_error` |
| Deterministic time: `datetime.now(timezone.utc)` bound to the tx timestamp (docs Transaction Context); removed the undocumented `gl.message_raw["datetime"]` hack | Portability + testability (warp in tests) | `_now()`; every timeout test uses `vm.warp` |
| All timeouts/economic constants/caps are validated `__init__` params | One contract replaces `registry.py` + `registry_demo.py` | `__init__`; `test_smoke.py` |
| Deterministic malformed-LLM fallback: canonical FLAG (matches SECURITY.md claim; v1.2 claimed it but it was an untested consensus artifact) | Documented behavior == tested behavior | `test_malformed_decide_canonical_flag` |

### New contract functionality
- **Permissionless consensus appeals**: `resolve_appeal()` callable by anyone after the cooldown; outcome decided by an independent EP round with the appellant note as untrusted context; **the owner can no longer resolve or overturn verdicts** (`resolve_appeal`, `test_appeals.py`).
- **Versioned rules**: `rules_versions: DynArray[RuleSet]`; items record the version they were judged under; `get_rules(version)`, `set_rules` (`test_rules.py`).
- **Per-axis bps thresholds**: owner sets FLAG/REMOVE per axis (≤10000 bps); verdicts computed from thresholds, not hardcoded 50/80; snapshotted into each rules version (`set_thresholds`, `test_custom_thresholds_change_verdict`).
- **Reputation with economic teeth**: honest/false reports and appeals won tracked per address; report bond drops to 80% at ≥3 reports and ≥70% honesty — a documented deterministic formula (`get_required_report_bond`, `test_reputation_discount_for_honest_reporter`).
- **`moderate_batch`** (≤5/call) with per-item error handling (`test_moderate_batch*`).
- **Full view surface** for UIs: `get_item/get_all_items(status_filter)/get_items_by_author|reporter|status/get_reputation/get_rules/get_config/get_stats/get_payouts`.

### Testing / tooling (security & architecture)
- **77 direct tests** (`tests/direct/`, in-memory GenVM, no network): lifecycle, consensus agreement (via `run_validator`), every settlement branch + a value-conservation invariant, appeals (overturned/upheld/reclaimed), anti-abuse (self-report ban, caps, dup-URL), reputation, batch, views.
- **genvm-lint in CI**; JUnit report artifact; `scripts/*.mjs` syntax checks. CI rewritten (was: `py_compile` of the outdated moderator.py only).

### New deployment — TODO (network-blocked, see below)
`scripts/deploy.mjs` deploys prod (86400/3600/172800 s) + demo (60 s) instances and writes `deployments.json`. **Blocked**: the local network resets large (>2 KB) outbound TLS payloads, so the ~80 KB deploy tx cannot be broadcast from this machine. Options queued: retry from a different network, or run the deployer in GitHub Actions with `PRIVATE_KEY` as a secret. On-chain proof artifacts (`docs/evidence/v2/registry-v2-proofs.json`) are produced by the resumable `scripts/proofs-v2.mjs` (fixture cycles incl. FLAG partial-forfeit, both report settlements via a locally funded burner reporter, injection fixtures, batch, rules v2, demo appeal resolve/reclaim/permissionless-enforce, revert proofs). Only real tx hashes are recorded.

### New integration
- **`packages/sdk`** — `@genlayer-cm/sdk`: typed client, view JSON → domain types, `waitForFinalized` with pre-broadcast-only retries, poll-based subscriptions; 10 vitest tests, typechecked.
- **`apps/api`** — Moderation-as-a-Service Route Handlers: `/api/items`, `/api/items/{id}`, `/api/stats`, `/api/reputation/{addr}`, `POST /api/moderate` (write mode behind `MODERATOR_KEY`, else read-only), embeddable **`/api/badge/{id}.svg`**, OpenAPI at `/api/openapi`; per-IP rate limiting + caching.

### Major feature — dApp (`apps/web`)
Next.js (App Router, static export for GitHub Pages): landing with live on-chain stats, registry explorer (filters/pagination from the contract), item page (status stepper, 7-axis radar, injection indicator, stake ledger, timeline, role-aware actions with guard explanations), submit wizard, reputation page, versioned-rules page with owner editor. Wallet: EIP-1193 connect + Bradbury network guard; reads are contract-only (no mocks); control-room design (graphite + single amber accent, mono for hashes/amounts).

### Traction
9 distinct fixtures (benign, borderline, mild, scam, spam, harassment, 3 injection variants) published on GitHub Pages and wired into the proof runner, so `get_stats` shows real multi-category history after the proof run (in progress — see deployment TODO).

## Why it matters
v1.2 was a single-contract demo with owner-controlled appeals and no tests. v2 is a verifiable moderation protocol: consensus you can reason about in code, appeals no one can override, economics that price dishonesty, an SDK/API for third parties, and a UI that surfaces the entire decision trail.
