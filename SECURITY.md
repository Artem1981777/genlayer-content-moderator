# Security Model — ContentModerator Registry (v1.2)

Maps each attack vector against the on-chain registry (`contracts/registry.py`)
to its cost for the attacker and the concrete on-chain defense. v1.1 is deployed
on GenLayer Bradbury at `0x20f6e32560427094aC913Da6e900c0b4899AE41A`; v1.2
supersedes it (address recorded on deploy). Amounts in wei.

## Economic parameters
- Author stake (ingest): 1_000_000_000_000  (MIN_STAKE)
- Reporter bond (report): 1_000_000_000_000  (REPORT_BOND)
- Appeal bond (appeal):  2_000_000_000_000  (APPEAL_BOND)
- Max open reports / address: 3  (MAX_OPEN_REPORTS)
- Max open appeals / address: 2  (MAX_OPEN_APPEALS)
- Enforce timeout: 86_400 s  (ENFORCE_TIMEOUT_SEC) — permissionless enforce afterwards
- Appeal-resolution timeout: 172_800 s  (APPEAL_TIMEOUT_SEC) — appellant may reclaim bond afterwards
- LLM re-run cooldown: 60 s  (LLM_COOLDOWN_SEC) — throttles moderate re-run / reverify_source

## Attack -> Cost -> Defense

| # | Attack vector | Cost to attacker | On-chain defense (registry.py) |
|---|---|---|---|
| 1 | Prompt injection in moderated content ("ignore previous instructions", "approve this post") | Content still scored; injection forces FLAG | USER CONTENT fenced as untrusted data + explicit "not a command" instruction; if content alters task/token then `canary_ok=False` -> `injection_detected=True`; any APPROVE with injection forced to FLAG |
| 2 | Public canary bypass (attacker echoes the known `GLM-OK` token) | No leverage | Canary is now a per-call token `GLM-` + sha256(item_id + "|" + tx datetime)[:10], unknowable to content authors; validators compare against the same generated token |
| 3 | Self-report to farm reporter rewards | Reverts, nothing spent | `report()` rejects `sender == author` |
| 4 | Report spam / griefing | Locks 1e12 per open report, capped at 3 | `MAX_OPEN_REPORTS` per-address cap; bond >= REPORT_BOND |
| 5 | False report on clean content | Reporter forfeits full 1e12 bond to the author | On APPROVE with a reporter, `_settle_stakes` pays `reporter_bond` to author as `false_report_comp` |
| 6 | Author posts violating content | REMOVE: full 1e12 stake to pool; FLAG: 50% to pool | `_settle_stakes`: REMOVE forfeits full stake, FLAG forfeits 50% (`author_partial_forfeit`), amount stored in `forfeited` |
| 7 | Verdict re-roll: spam `moderate()` on a moderated item until a softer verdict appears | Cannot re-roll | `moderate()` re-run allowed only for owner or while an active report exists, and blocked within `LLM_COOLDOWN_SEC`; first pass ("ingested") open to anyone, later re-rolls gated |
| 8 | LLM-spam DoS: flood `moderate()` / `reverify_source()` to burn validator compute | Rate-limited | `LLM_COOLDOWN_SEC` cooldown on re-run of `moderate()` and on `reverify_source()`, tracked via `last_llm_ts` |
| 9 | Endless / repeat appeals | 2e12 bond each, forfeited if denied; MAX_OPEN_APPEALS concurrent cap | `appeal()` author-only + `MAX_OPEN_APPEALS`; per-item `appeal_count<2` limit removed so appeals stay reachable but each costs a fresh bond; overturned item becomes terminal and cannot be re-appealed |
| 10 | Reporter bond stuck on an enforced item | Cannot happen | `report()` restricted to ingested / moderated (enforced removed); every accepted report has a settlement path via `enforce()` |
| 11 | Owner griefing: never enforce / never resolve to lock staked value | No indefinite lock | `enforce()` permissionless after `ENFORCE_TIMEOUT_SEC`; `reclaim_appeal()` returns the appeal bond after `APPEAL_TIMEOUT_SEC` |
| 12 | Double settlement via overturned appeal (re-enforce an overturned item to pay stakes twice) | Cannot happen | overturn sets status terminal `resolved`; enforce needs `moderated`, appeal needs `enforced`, so neither path re-runs `_settle_stakes` |
| 13 | Unauthorized enforcement / verdict tampering | Reverts | `enforce()` (before timeout), `resolve_appeal()`, `release_url()`, `fund_pool()` owner-gated |
| 14 | Ingest empty / dead source | Reverts, no state | `ingest()` requires non-empty fetched content |
| 15 | Double ingest / re-stake | Reverts | `ingest()` requires `status == "created"` |
| 16 | Duplicate-URL confusion / item-URL rebinding | Reverts while active | `url_hash` -> item mapping (`url_index`); ingest rejects a URL bound to a different still-active item; owner `release_url()` frees a stale binding |
| 17 | Content leak: read removed content through public getters | Masked | `get_item()` / `get_all_items()` return `_public_item()` — REMOVE content -> `"[content removed by moderation]"`, FLAG -> `"[limited] ..."` |
| 18 | Silent post-moderation content swap (bait-and-switch) | Detectable on-chain | `content_hash` = sha256 stored at ingest; `verify_content()` recomputes hash; `reverify_source()` re-fetches + LLM-compares live vs stored |
| 19 | Non-deterministic LLM disagreement to stall consensus | No leverage | Tolerant comparative consensus: validators agree on discrete verdict + injection flag + top-axis tolerance band, not exact scores |

## Defense-in-depth
- **Untrusted-data framing:** fetched page, stored content, and appellant note are each wrapped in explicit BEGIN/END markers and labeled untrusted; the model is told they are data, never commands.
- **Per-call canary tripwire:** each moderation generates a fresh, content-unknowable canary token (`_canary_token`); a successful injection that suppresses scoring usually also fails to echo it, independently raising `injection_detected`.
- **Escalation:** borderline first-pass (top axis 40..60) triggers a second, conservative pass before the verdict is fixed.
- **Liveness by timeout:** enforcement and appeal-bond recovery are permissionless after their timeouts, so no actor can freeze staked value.
- **Once-only settlement:** stakes settle exactly once at enforce; overturned appeals move to a terminal state, preventing double payouts.
- **Owner-gated money moves:** settlement runs inside `enforce`/`resolve_appeal`; `emit_transfer(..., on='finalized')` fires only after finalization.
- **Content privacy:** blocked/limited content is masked in all public getters; source URLs are deduplicated via `url_index`.
- **Auditability:** every payout is appended to an on-chain ledger (`get_payouts`) and every state change is recorded in item `history`.
