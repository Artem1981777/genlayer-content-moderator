# GenLayer ContentModerator

An **Intelligent Contract** on GenLayer that moderates user-generated content with an LLM, fully on-chain — now **self-calibrating**: it reports how confident it is, automatically escalates borderline cases to a stricter second review, classifies the violation, and keeps an auditable appeal history.

- **Network:** GenLayer testnet (Bradbury, chain id 4221)
- **Live demo:** https://artem1981777.github.io/genlayer-content-moderator/
- **Version:** 0.3.0

## What's new in v0.3.0

- **AI confidence (0–100):** every verdict carries a calibrated confidence score, stored on-chain.
- **Auto-escalation:** if the first pass is not confident (< 70), the contract automatically runs a second, stricter, safety-first review — inside the same consensus block.
- **Human-review gate:** if it still cannot decide with confidence (< 60), the verdict is forced to `FLAG` and `needs_review` is set.
- **Violation categories:** `spam`, `harassment`, `hate`, `violence`, `sexual`, `self_harm`, `other`, `none`.
- **Consensus-robust:** validators compare only the final `verdict`, so differing confidence/escalation paths never stall consensus.

## Verdicts

- `APPROVE` — complies with the rules
- `FLAG` — borderline / needs human review
- `REMOVE` — clear violation

## How it works

1. Deploy with `rules` + `content`.
2. `moderate()` runs pass 1 (verdict + confidence + category). If confidence < 70 → escalated pass 2 (conservative). If final confidence < 60 → `FLAG` + `needs_review`.
3. The whole decision runs under `gl.eq_principle.prompt_comparative`, which requires validators to agree on the final verdict.
4. `appeal(note)` re-runs the pipeline with the appellant's (untrusted) context and appends a new history round (max 2 appeals).

## Live deployment (v0.3.0)

- Contract: `0xbf844361E8d9CD30a11ff4b6Fe7E715413C17fC5`
  https://explorer-bradbury.genlayer.com/address/0xbf844361E8d9CD30a11ff4b6Fe7E715413C17fC5
- Deploy tx: `0xce8f1d9bda70e71e3d5f5ef264373ceac2de421feec28b39d35b5e1aee9b0cf2`
- Moderate tx (REMOVE · confidence 100 · spam): `0x465df343b2effe0285949744f027614ace1a13162a506c86efc9090f68ceb8b0`
- Appeal tx (held REMOVE): `0x25fe6839f38ddb85076c590fdc7e252910a00502d68eb04e6a032d589b79dfdc`

## Contract API

- `moderate()` — moderate the stored content (once).
- `appeal(note: str)` — re-review with an appellant note (max 2).
- `set_content(content: str)` — creator only, before moderation.
- `get_state()` — full state incl. `verdict`, `confidence`, `category`, `escalated`, `needs_review`, `history`.

## Run locally

```bash
npm install
echo "PRIVATE_KEY=0xYOUR_TESTNET_KEY" > .env

# deploy
node --env-file=.env deploy.mjs
# moderate -> appeal demo
node --env-file=.env interact.mjs
# full test suite (10 tests, live on testnet)
node --env-file=.env test.mjs
```

## Testing

10/10 live end-to-end tests on testnet: harmful→REMOVE/FLAG, benign→APPROVE, double-moderate guard, late `set_content` guard, empty-content guard, appeal history, empty-appeal guard, early-appeal guard, appeal cap (2), and confidence/category/flags metadata.

## Security

See `docs/SECURITY-AUDIT.md`. Highlights: untrusted-content prompt isolation, skeptical appellant context, verdict-only consensus, bounded single escalation, deterministic parse fallback to `FLAG`, submit-retry for consensus-contract write ordering, appeal DoS cap, creator-only content changes.

## License

MIT

## v0.4.0 — Verifiable content record + enforcement & appeal workflow
This release addresses steward feedback: the moderation verdict is now bound to an authenticated platform item and consumed by a real enforcement + appeal workflow, tested on-chain.
- Constructor records an authenticated content record: `rules`, `content`, `item_id`, `source`, `author`, and a sha256 `content_hash`.
- Consequential, permissioned paths:
  - `moderate` — AI consensus verdict (APPROVE / FLAG / REMOVE)
  - `enforce` — applies the verdict (REMOVE blocks the item, FLAG limits it); `read_content` returns `[REMOVED BY CONSENSUS MODERATION]` when blocked
  - `appeal(note)` — author disputes an enforced FLAG/REMOVE (max 2 appeals)
  - `resolve_appeal` — re-runs consensus, sets OVERTURNED or UPHELD, updates enforcement
- `verify_content(content)` proves tamper detection against the stored `content_hash`.
- Full on-chain audit trail via `get_state().history`.

### Live demo (Bradbury testnet)
- Contract: `0x30Bb0bc6dA84d377C339949DDfF2d87539F77EB7`
- moderate → REMOVE: `0x2dfc598349349a8cc69cf774ff8c07d95bfc9de3399a9a75f9faea022fc0f06c`
- enforce → blocked: `0x50cd96099418f555d91b4e4d27288902940a1b7793780bb96a50dc434cb5bde4`
- appeal (author): `0x8578d3e39d485c106d7e33ea35aa74793b441545ca9be70f09a4227219652e79`
- resolve_appeal → UPHELD: `0x14fa4e5b4bfdd1eb488c31b2894391d5f65d2459e806112133f51c047e4513c5`
- Explorer: https://explorer-bradbury.genlayer.com/address/0x30Bb0bc6dA84d377C339949DDfF2d87539F77EB7
