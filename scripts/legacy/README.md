# Legacy one-off scripts

v0.x–v1.2 era utilities kept for the audit trail (stewards can trace every
historical proof run to one of these). They hardcode the v1.x contract
address and the pre-upgrade consensus encoding, so they no longer run
against the current Bradbury consensus.

The reproducible v2 pipeline lives in `scripts/` proper:
deploy.mjs → smoke.mjs → proofs-v2.mjs (+ lib/, diagnostics/).
