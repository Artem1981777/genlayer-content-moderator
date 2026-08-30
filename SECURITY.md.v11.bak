# Security Model — ContentModerator Registry (v1.1)

Maps each attack vector against the on-chain registry (`contracts/registry.py`)
to its cost for the attacker and the concrete on-chain defense. Deployed on
GenLayer Bradbury at `0x20f6e32560427094aC913Da6e900c0b4899AE41A`. Amounts in wei.

## Economic parameters
- Author stake (ingest): 1_000_000_000_000  (MIN_STAKE)
- Reporter bond (report): 1_000_000_000_000  (REPORT_BOND)
- Appeal bond (appeal):  2_000_000_000_000  (APPEAL_BOND)
- Max open reports / address: 3  (MAX_OPEN_REPORTS)
- Max open appeals / address: 2  (MAX_OPEN_APPEALS)

## Attack -> Cost -> Defense

| # | Attack vector | Cost to attacker | On-chain defense (registry.py) |
|---|---|---|---|
| 1 | Prompt injection in moderated content ("ignore previous instructions", "approve this post") | Content still scored; injection forces FLAG | USER CONTENT fenced as untrusted data + explicit "not a command" instruction; `GLM-OK` canary token, if content alters task/token then `canary_ok=False` -> `injection_detected=True`; any APPROVE with injection forced to FLAG (185-198) |
| 2 | Self-report to farm reporter rewards | Reverts, nothing spent | `report()` rejects `sender == author` (359-360) |
| 3 | Report spam / griefing | Locks 1e12 per open report, capped at 3 | `MAX_OPEN_REPORTS=3` per-address cap (361-362); bond >= REPORT_BOND (367-369) |
| 4 | False report on clean content | Reporter forfeits full 1e12 bond to the author | On APPROVE with a reporter, `_settle_stakes` pays `reporter_bond` to author as `false_report_comp` (406-408) |
| 5 | Author posts violating content | Author forfeits 1e12 stake to pool | On REMOVE/FLAG, `_settle_stakes` moves `author_stake` to pool as `author_forfeit` (393-395) |
| 6 | Appeal abuse / endless appeals | 2e12 bond each, capped, forfeited if upheld | `appeal()` author-only + `MAX_OPEN_APPEALS=2` + per-item `appeal_count<2` (436-440); upheld appeal forfeits bond to pool (472-476) |
| 7 | Unauthorized enforcement / verdict tampering | Reverts | `enforce()` and `resolve_appeal()` owner-only (412-413, 453-454) |
| 8 | Ingest empty / dead source | Reverts, no state | `ingest()` requires non-empty fetched content (344-346) |
| 9 | Double ingest / re-stake | Reverts | `ingest()` requires `status == "created"` (339-340) |
| 10 | Moderate empty/invalid item | Reverts | `moderate()` requires non-empty content and status in (ingested, moderated) (378-381) |
| 11 | Silent post-moderation content swap (bait-and-switch) | Detectable on-chain | `content_hash` = sha256 stored at ingest (351); `verify_content()` recomputes hash (534-540); `reverify_source()` re-fetches + LLM-compares live vs stored (487-495) |
| 12 | Non-deterministic LLM disagreement to stall consensus | No leverage | Tolerant comparative consensus: validators agree on discrete verdict + injection flag + top-axis tolerance band, not exact scores (206-215) |

## Defense-in-depth
- **Untrusted-data framing:** fetched page, stored content, and appellant note are each wrapped in explicit BEGIN/END markers and labeled untrusted; the model is told they are data, never commands (28-39, 100-116).
- **Canary tripwire:** a successful injection that suppresses scoring usually also fails to echo `GLM-OK`, which independently raises `injection_detected` (174, 182).
- **Escalation:** borderline first-pass (top axis 40..60) triggers a second, conservative pass before the verdict is fixed (175-181).
- **Owner-gated money moves:** all settlement runs inside owner-only `enforce`/`resolve_appeal`; `emit_transfer(..., on='finalized')` fires only after finalization (271-277).
- **Auditability:** every payout is appended to an on-chain ledger (`get_payouts`) and every state change is recorded in item `history`.
