# Security Model — ContentModerator Registry v2

Maps each attack vector against `contracts/registry_v2.py` to its cost for the
attacker and the concrete on-chain defense. Amounts in wei; economic constants
are `__init__` parameters (defaults: stake/bond 1e12, appeal bond 2e12).

> Changes vs v1.2: the per-call canary echo was **removed** — it added an
> LLM-echo reliability dependency inside consensus without participating in the
> code-defined agreement; injection detection now rests on the dedicated
> numeric `injection_attempt` axis (0–100, agreement band 50) plus deterministic
> post-processing. Fetch-time failures are no longer swallowed into empty
> content: they surface as classified, consensus-agreed errors.

## Attack -> Cost -> Defense

| # | Attack vector | Cost to attacker | On-chain defense (registry_v2.py) |
|---|---|---|---|
| 1 | Prompt injection in moderated content | Content still scored; APPROVE + injection is forced to FLAG | untrusted-data markers; numeric `injection_attempt` axis; `_decide` post-processing |
| 2 | Validator disagreement / LLM manipulation to smuggle a verdict | Consensus fails, leader rotates | code-defined agreement: verdict equality, per-axis \|Δ\|≤15 (`SCORE_TOLERANCE`), injection band >50 — see `_decisions_agree`; tested via `run_validator` |
| 3 | Malformed LLM output used to force a lenient verdict | Deterministic canonical FLAG | `_decide` fallback + `test_malformed_decide_canonical_flag` |
| 4 | Dead-source or non-http source griefing at ingest | Revert before stake is locked | scheme/length validation at `ingest`; fetch failures classified `[EXTERNAL]`/`[TRANSIENT]` at `moderate` |
| 5 | Self-report farming | Reverts, nothing spent | `report()` rejects `sender == author` |
| 6 | Report spam | Locks bond per open report, capped (default 3) | `max_open_reports`, per-address load tracking |
| 7 | False reports on clean content | Bond paid to the author | `false_report_comp` settlement; `false_reports` reputation; bond discount requires ≥70% honesty |
| 8 | Violating content for profit | REMOVE forfeits full stake; FLAG forfeits half | `_settle_stakes` (+ exact `forfeited` restore on overturn) |
| 9 | Verdict re-roll spamming | Owner-only or needs an active report; LLM cooldown | `moderate()` re-run gate |
| 10 | Owner freezes staked value | Cannot | permissionless `enforce` after timeout; permissionless `resolve_appeal` after cooldown; `reclaim_appeal` after appeal timeout |
| 11 | **Owner overrides verdicts** | Impossible by design | owner has no verdict path at all in v2: `resolve_appeal` is consensus-driven and permissionless; owner only sets rules/thresholds |
| 12 | Threshold manipulation after items are judged | No retroactive effect | judged items store `rules_version`; each version snapshots its thresholds |
| 13 | Reputation gaming (self-dealing reporters) | Needs two keys and sacrificed bonds; discounts only reach 80% | discount requires ≥3 settled reports and ≥70% honesty — deterministic formula, `get_reputation` is public |
| 14 | Appeal-note injection | Weighed as untrusted context, cannot override rules | appellant note wrapped/framed as untrusted; consensus agreement still applies |
| 15 | Duplicate-URL confusion | Reverts while active | `url_index` guard; owner `release_url` |
| 16 | Content leak | Masked | blocked/limited content masked in `get_item`/`get_all_items`/`read_content` |
| 17 | Bait-and-switch content swap | Detectable | `content_hash` = sha256 at consensus time; `verify_content`; `reverify_source` re-fetch under consensus |
| 18 | Batch DoS | Bounded | `moderate_batch` ≤ `MAX_BATCH` (5), per-item errors isolated |
| 19 | API abuse (apps/api) | Rate limited | per-IP sliding-window limiter; write mode disabled unless `MODERATOR_KEY` is configured; read caching |

## Known limitations (honest)
- Dead sources surface at `moderate` (stake already locked at `ingest`); the
  owner cannot free stakes of permanently dead ingests — same failure mode as
  v1.2, mitigated by retryable classified errors and permissionless liveness.
- `injection_attempt` is a validator-reported score, not a cryptographic proof;
  a validator must first be convinced by the content itself.
- Reputation discounts are bounded (80%) to keep farming unprofitable.
