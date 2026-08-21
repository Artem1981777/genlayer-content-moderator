# ContentModerator — AI Content Moderation on GenLayer

ContentModerator is a GenLayer Intelligent Contract that moderates user-generated content through validator consensus instead of a single trusted moderator. Community rules live on-chain; each decision is produced by an LLM run by every validator and finalized by comparative consensus, with a full on-chain audit trail.

Live demo: https://artem1981777.github.io/genlayer-content-moderator/

## v0.5.0 — authenticated ingestion (what changed)

Earlier versions let the operator supply the item id, source, author and content, and verify_content only re-hashed that operator-supplied text. v0.5.0 makes the moderated record authenticated and non-operator-controlled:

- Content is bound to a fetched platform source. ingest(url) makes the contract itself fetch the live page under validator consensus (gl.nondet.web.render inside gl.eq_principle.prompt_comparative). The operator can no longer type or inject content.
- The record is derived, not chosen: content_hash = sha256(fetched content), item_id = sha256(source url), source = the fetched url.
- The author is bound to a transaction signature: ingest() sets author = gl.message.sender_address, so operator and author are two distinct, cryptographically-authenticated identities.
- The operator overwrite path (old set_content) has been removed entirely.
- reverify_source() re-fetches the live source under consensus and confirms the on-chain record still matches (live authenticity, not just a static hash).

## Lifecycle

created -> pending -> moderated -> enforced -> appealed -> resolved

- ingest(url) — author-signed; fetches and records the authenticated content (created -> pending)
- moderate() — validator consensus produces APPROVE / FLAG / REMOVE (pending -> moderated)
- enforce() — creator-only; REMOVE blocks the item (read_content returns [REMOVED BY CONSENSUS MODERATION]), FLAG limits it (moderated -> enforced)
- appeal(note) — author-only; opens an appeal (enforced -> appealed)
- resolve_appeal() — creator-only; re-runs consensus, sets OVERTURNED or UPHELD (appealed -> resolved)
- reverify_source() — re-fetches the source under consensus, records match=true/false
- read_content(), verify_content(text), get_state() — views

## Live proof on GenLayer Testnet (Bradbury)

Contract v0.5.0: 0x235F51b11b9F96d6673df37553Ef58373c4324F9

Full authenticated run with separate operator and author accounts:

- Operator / creator: 0x198a1952BD58984281f57CF824d264cdbd412814
- Author: 0xB596E24480e6a9a54d5303d84791917Bcf8b64D0

Transactions (explorer https://explorer-bradbury.genlayer.com):

- Deploy: 0x64259ee887518a53e6113802b9acf8c898a9ad7d31c577cee579b32b358da6b7
- Ingest (author, fetched-source authentication): 0x6eaec3df8622bdb8b75ad3dfb3c993b8ab0c1936e87d94c864780d8f91b0166d
- Moderate (consensus REMOVE): 0x804259ded07a85df7f03f903e71ef41f3ad328e147566fa3ee7d142c2734b3fa
- Enforce (blocked): 0x495929b71cde3d002d6d91f9f769bc0ba55a675137f911bd70e59f9815a5cbb4
- Appeal (author): 0x764ae9f00511c7d8b26ce45bb271f0a9db90115e2f2196ec5a46937869afa39f
- Resolve appeal (UPHELD): 0xdab5c49935d6f9cd91d3087be08c6f9e1c11f78713384a7053c9298d443f49e7
- Reverify source (match=true): 0x58d4b8e14036845489968b0392619e4f293d2c01641eb5794cfb74f512ce1d3f

Result: verdict REMOVE (confidence 100), read_content masked, appeal UPHELD, reverify match=true, verify_content(recorded)=true and verify_content(tampered)=false.

Authenticated source fetched in the run:

- Scam post (REMOVE): https://artem1981777.github.io/genlayer-content-moderator/fixtures/scam.html
- Benign post (APPROVE case): https://artem1981777.github.io/genlayer-content-moderator/fixtures/benign.html

## Security

- Fetched content is treated as untrusted data (prompt-injection defense: embedded instructions are judged, never executed).
- Subjective judgement uses eq_principle comparative consensus; malformed model output defaults to FLAG.
- Creator-only enforcement and appeal resolution; author-only appeals; strict state-machine guards.
- Authenticated, immutable record: no operator overwrite path; verify_content and reverify_source provide tamper and live-source checks.

## Repository layout

- contracts/moderator.py — the Intelligent Contract (v0.5.0)
- test.mjs — full two-role end-to-end test (operator + author)
- resume.mjs — idempotent runner that attaches to a deployed contract and drives the remaining steps (congestion-tolerant)
- fixtures/ — public sample posts used as authenticated sources

## Run

    npm i genlayer-js
    node --env-file=.env test.mjs

The operator key (PRIVATE_KEY) is read from .env; the author key is read from a separate local file (never committed). GenLayer Testnet Bradbury: chain id 4221, RPC https://rpc-bradbury.genlayer.com.
