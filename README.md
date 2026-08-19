# ContentModerator — AI Content Moderation on GenLayer

An **Intelligent Contract** that moderates user content **without a centralized moderator**. It stores community rules and a piece of content; when `moderate()` is called, each GenLayer validator independently asks an LLM to judge the content strictly against the rules, and the network reaches **comparative consensus** on a verdict: `APPROVE`, `FLAG`, or `REMOVE`, with a short human-readable reason recorded on-chain.

## Why it matters

Content moderation is a subjective judgement call — exactly what a normal smart contract cannot do, forcing platforms to rely on a trusted company or a human team. GenLayer performs subjective reasoning natively and makes validators **agree** on the outcome. This contract shows moderation that is transparent, auditable, and decentralized: the rules, the content, the verdict, and the reason all live on-chain.

## Live deployment (Testnet Bradbury)

- **Contract:** `0x237fD615062d9C952659DC357eaA94B8Be1370DC`
- **Network:** GenLayer Testnet Bradbury (Chain ID `4221`)
- **Explorer:** https://explorer-bradbury.genlayer.com/address/0x237fD615062d9C952659DC357eaA94B8Be1370DC

### Verified on-chain demo — verdict `REMOVE`

- **Content moderated:** a crypto giveaway scam that asks users to send ETH and DM their wallet seed phrase.
- **Verdict:** `REMOVE` — *"Contains a scam requesting seed phrases and promoting an unrealistic giveaway."*

| Step | Transaction hash |
| --- | --- |
| Deploy | `0x6a5b439dfa06df5740241500662180435555ef7b3001c8ddb20bc4b0a0269445` |
| moderate (AI verdict) | `0x8d5174712f144395ce1f380b6605c133648e0e89837955ff855d10f260196069` |

The validator network independently read the content, applied the rules, and agreed to remove it — no oracle, no human reviewer.

## How it works

1. **Deploy** sets the market for moderation: `rules` (community guidelines) and the `content` to judge. Status starts at `pending`.
2. **set_content(content)** lets the **creator** update the content while it is still pending.
3. **moderate()** runs a non-deterministic block:
   - `gl.nondet.exec_prompt(...)` asks an LLM to return a strict JSON verdict (APPROVE / FLAG / REMOVE) with a reason, judging the content only against the rules,
   - `gl.eq_principle.prompt_comparative(...)` makes validators reach consensus on the verdict (the correct equivalence principle for subjective LLM output).
4. The verdict and reason are written on-chain; status becomes `moderated`.

## Security & tests

Hardening applied (see `docs/SECURITY-AUDIT.md` for the full review):

- **Prompt-injection defense:** the content is explicitly framed as untrusted data that is never a command; the model is constrained to a strict JSON enum.
- **Consensus determinism:** subjective output uses `prompt_comparative`, not `strict_eq`.
- **Robust parsing:** malformed LLM output is caught and safely defaults to `FLAG` for human review.
- **Access control:** only the `creator` can change the content.
- **State guards:** content cannot be moderated twice, cannot be changed after moderation, and empty content cannot be moderated.

Automated suite (`test.mjs`), **5/5 passing** on live Testnet Bradbury:

- Harmful content is moderated and not approved (REMOVE/FLAG).
- Benign content is approved (APPROVE).
- moderate() cannot run twice.
- set_content reverts after moderation.
- moderate() reverts on empty content.

**Known limitation:** each contract instance moderates a single content item, and the verdict is advisory — it is recorded on-chain for any platform to enforce, but this version does not implement platform-side removal actions or an appeals workflow. Those are the planned next iteration.

## Contract interface

- `get_state() -> dict` (view) — rules, content, status, verdict, reason.
- `set_content(content: str)` (write, creator-only) — update content while pending.
- `moderate()` (write) — validators reach a verdict via consensus.

## Run it yourself

    npm install            # genlayer-js + viem
    cp .env.example .env   # then fill PRIVATE_KEY and ADDRESS of a funded Bradbury wallet
    npm run deploy         # deploys, writes contract.txt + deploy-tx.txt
    npm run interact       # end-to-end demo: read -> moderate -> read (verdict)
    npm run test           # automated security/behavior suite on live testnet

## Tech

- **Contract:** Python Intelligent Contract on GenVM (pinned py-genlayer runner).
- **Client:** genlayer-js on Node.js.
- **Consensus:** GenLayer Optimistic Democracy + Equivalence Principle (prompt_comparative).

## Files

- `contracts/moderator.py` — the ContentModerator Intelligent Contract.
- `deploy.mjs` — deploys the contract, saves address to contract.txt.
- `interact.mjs` — end-to-end demo (state -> moderate -> state).
- `test.mjs` — automated security/behavior test suite.
- `docs/SECURITY-AUDIT.md` — self-conducted security audit.
- `.github/workflows/ci.yml` — static checks (contract + client syntax).

## License

MIT — see `LICENSE`.
