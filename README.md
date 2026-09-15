# ContentModerator — AI Content Moderation on GenLayer (v2)

[![CI](https://github.com/Artem1981777/genlayer-content-moderator/actions/workflows/ci.yml/badge.svg)](https://github.com/Artem1981777/genlayer-content-moderator/actions/workflows/ci.yml)
[![Contract](https://img.shields.io/badge/contract-registry__v2-amber)](contracts/registry_v2.py)
[![Tests](https://img.shields.io/badge/direct%20tests-77-green)](tests/direct)

> Decentralized content moderation as a GenLayer Intelligent Contract: validator-consensus verdicts
> agreed by code, staking with real consequences, **permissionless consensus appeals the owner cannot
> override**, on-chain reputation, and a full monorepo (contract + 77 tests + SDK + API + dApp).

## What's new in v2 (vs accepted v1.2)

Full delta with per-item verification: **[docs/MILESTONE-v2.md](docs/MILESTONE-v2.md)**.

| Area | v1.2 | v2 |
|---|---|---|
| Storage | JSON strings in `TreeMap[str,str]` | native `@allow_storage` dataclasses, typed indexes, `u64/u256` |
| Consensus | `prompt_comparative` (LLM judges equivalence) | explicit `run_nondet_unsafe` — validator re-runs and agrees **by code** (verdict equality, per-axis tolerance ≤15, injection band >50) |
| Appeals | owner-only `resolve_appeal` | **permissionless consensus resolution; owner cannot touch verdicts** |
| Rules | fixed text + hardcoded 50/80 cutoffs | versioned `RuleSet`, per-axis thresholds in bps |
| Errors | swallowed into empty content | `[EXTERNAL]` / `[TRANSIENT]` / `[LLM_ERROR]` classification, docs error-agreement pattern |
| Time | undocumented `gl.message_raw["datetime"]` | deterministic `datetime.now(timezone.utc)` = tx timestamp |
| Tests | none (live .mjs scripts only) | **77 direct in-memory GenVM tests** + SDK vitest suite |
| Integrations | — | `@genlayer-cm/sdk`, Moderation-as-a-Service API with SVG verdict badges |
| UI | single legacy `registry.html` | Next.js dApp (explorer, item forensics, submit wizard, reputation, rules) |

## Repository layout (monorepo)

```
contracts/registry_v2.py     the v2 Intelligent Contract (single deployable unit)
contracts/moderator.py       v0.5.0 (history)     contracts/registry.py  v1.2 (history)
tests/direct/                77 in-memory GenVM tests (genvm via genlayer-test)
packages/sdk/                @genlayer-cm/sdk — typed TypeScript client (vitest)
apps/api/                    Moderation-as-a-Service Route Handlers + SVG badges + OpenAPI
apps/web/                    Next.js dApp (static export for GitHub Pages)
scripts/                     deploy.mjs (prod+demo), proofs-v2.mjs (resumable proofs), v1 legacy scripts
fixtures/                    public sample posts served via GitHub Pages as ingest sources
docs/                        MILESTONE-v2.md, SECURITY-AUDIT.md, evidence/v1 + v2
```

## The contract (registry v2)

- **Lifecycle**: `created → ingested → moderated → enforced → (appealed → resolved)`; `enforce()` is
  permissionless after `ENFORCE_TIMEOUT_SEC`; `resolve_appeal()` after the cooldown by **anyone** —
  the outcome comes from an independent validator consensus round with the appellant note as
  untrusted context; `reclaim_appeal()` after `APPEAL_TIMEOUT_SEC` returns the bond (liveness).
- **Equivalence Principle**: one `run_nondet_unsafe` round = fetch page → extract content → score 7
  harm axes + `injection_attempt` (0–100). The validator re-runs the whole pass and compares decision
  fields only: verdict equality, |Δscore| ≤ 15 per axis, both-or-neither injection >50.
  Verdicts derive from per-axis bps thresholds; injection forces APPROVE→FLAG; malformed LLM output
  deterministically falls back to a canonical FLAG.
- **Economy**: author stake (full refund on APPROVE, half forfeit on FLAG, full forfeit on REMOVE),
  reporter bond (reward from forfeits / slashed to author on false reports), appeal bond (refunded +
  forfeited restore when consensus lightens the verdict, else forfeited to the pool). Reputation
  scales the report bond to 80% for consistently honest reporters (documented formula).
- **Owner powers**: rules text (versioned), per-axis thresholds, pool funding, URL release.
  **No verdict power.**

See [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Deployments (Bradbury testnet)

| Version | Address | Status |
|---|---|---|
| v2.0.0 prod | TODO — deploy blocked by local network (see below) | pending |
| v2.0.0 demo (60 s timeouts) | TODO | pending |
| v1.2 | `0x62A9196dBB55585840D13631aB7C68288761a74A` | active (history) |
| v1.1 | `0x20f6e32560427094aC913Da6e900c0b4899AE41A` | history |
| v0.5.0 | `0x235F51b11b9F96d6673df37553Ef58373c4324F9` | history |

On-chain proofs land in `docs/evidence/v2/` — every recorded hash is a real transaction.

## Run

```bash
pip install -r requirements.txt
genvm-lint check contracts/registry_v2.py     # lint + validation
pytest tests/direct                           # 77 tests, no network

cd packages/sdk && npm i && npm test          # SDK vitest suite
cd apps/web && npm i && npm run build         # static dApp
cd apps/api  && npm i && npm run dev          # Moderation-as-a-Service
```

Deploy + on-chain proofs (needs funded key in `.env`):

```bash
node --env-file=.env scripts/deploy.mjs       # prod + demo -> deployments.json
node --env-file=.env scripts/proofs-v2.mjs    # resumable proof suite -> docs/evidence/v2/
```

### Reproducible public demo release

The repository includes manual GitHub Actions workflows for the network-dependent release path. Add a funded Bradbury key as the repository secret `PRIVATE_KEY`, run **Deploy contract (manual)**, and review the resulting addresses in `deployments.json`. The deployment workflow never stores the key; it commits only public deployment metadata and uploads resumable state. Once `deployments.json` contains `prod.address`, **Deploy dApp to GitHub Pages** injects that address into `NEXT_PUBLIC_REGISTRY_ADDRESS` at build time. If the v2 contract is not deployed yet, Pages still publishes the UI but labels it **Deployment pending** instead of silently presenting an empty live dashboard. The same web build can be run locally with `NEXT_PUBLIC_REGISTRY_ADDRESS=<Bradbury address> npm run build` from `apps/web`.

## Documentation

- [docs/MILESTONE-v2.md](docs/MILESTONE-v2.md) — delta vs accepted v1.2 with verification pointers
- [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)
- [CHANGELOG.md](CHANGELOG.md) — full history v0.1.0 → v2.0.0
- Legacy single-page dApp: [registry.html](docs/legacy/registry.html) (superseded by apps/web)
