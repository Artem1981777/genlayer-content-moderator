# ContentModerator — Security Audit (v0.3.0)

Scope: `contracts/moderator.py` (GenLayer Intelligent Contract). Threat model: untrusted user content, adversarial appellants, prompt injection, consensus stalls, and access-control abuse.

## Findings & mitigations

### F1 — Prompt injection via USER CONTENT (High) — Mitigated
Content is wrapped in explicit BEGIN/END markers and labeled untrusted; the prompt states that any instruction inside the content is not a command, only text to judge.

### F2 — Appellant-context injection (High) — Mitigated
The appeal note is wrapped in APPEAL markers and framed as an untrusted claim to be weighed skeptically; it cannot override the rules.

### F3 — Consensus divergence from confidence branching (High) — Mitigated
Confidence/escalation are computed inside one nondeterministic block, and `prompt_comparative` requires validators to agree only on the final `verdict`. Differences in confidence, category, wording, or whether escalation occurred are explicitly declared irrelevant, so validators converge on the decision.

### F4 — Consensus-contract write ordering (Medium) — Mitigated (tooling)
A second write to the same contract before the previous one finalizes reverts. Clients (`interact.mjs` / `test.mjs`) use a submit-retry that waits out finalization on "consensus contract" / "EVM tx" errors.

### F5 — Escalation abuse / infinite loop (Medium) — Mitigated
Escalation is bounded to exactly one extra pass; there is no recursion and no attacker-controllable loop count.

### F6 — Confidence spoofing (Medium) — Mitigated
A malicious author cannot raise trust: low final confidence forces `FLAG` + `needs_review`, and the safety-first escalation pass refuses to APPROVE plausible violations. Confidence never relaxes a decision.

### F7 — Non-deterministic / malformed model output (Medium) — Mitigated
Output is parsed defensively (JSON + brace-substring fallback); unparseable output defaults to `FLAG` with `needs_review`, never a silent APPROVE. Confidence is clamped to 0–100; category is whitelisted.

### F8 — Appeal-spam DoS (Low) — Mitigated
Appeals are capped at 2 per case; empty notes revert; appeals before moderation revert.

### F9 — Unauthorized content mutation (Low) — Mitigated
`set_content` is creator-only and only before moderation; content cannot be swapped after a verdict.

## Residual risk
LLM judgment is probabilistic; genuinely ambiguous content may oscillate near the escalation threshold. This is intentionally routed to `FLAG` / `needs_review` for a human, which is the safe default.
