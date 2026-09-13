import { Shell } from "@/components/shell";

export const metadata = { title: "Docs — ContentModerator" };

const SECTIONS = [
  {
    title: "How a verdict is made",
    body: [
      "ingest(url): the author locks a stake; the contract validates the URL (http(s), ≤512 chars) and rejects duplicates under active moderation.",
      "moderate(): one Equivalence Principle round runs on every validator: (1) fetch the page as text, (2) extract the primary user content with an LLM, (3) score 7 harm axes 0–100 plus an injection_attempt axis. The validator re-runs the same pass and compares only decision fields: verdict equality, per-axis score tolerance ≤15, injection band (>50).",
      "Verdicts are computed from per-axis thresholds in bps, never from hardcoded cutoffs. Detected prompt injection forces an APPROVE up to FLAG. Malformed model output deterministically falls back to a canonical FLAG.",
    ],
  },
  {
    title: "Stakes and settlements",
    body: [
      "Author stake: fully refunded on APPROVE; half forfeited to the pool on FLAG (author_partial_forfeit); fully forfeited on REMOVE.",
      "Reporter bond: on REMOVE/FLAG the reporter is paid the bond plus half of the forfeited stake as a reward; on APPROVE the bond is paid to the author as false-report compensation.",
      "Appeal bond: if validator consensus lightens the verdict (overturned), the bond is refunded and the forfeited amount is restored from the pool; otherwise the bond is forfeited to the pool.",
    ],
  },
  {
    title: "Appeals are permissionless",
    body: [
      "resolve_appeal() can be called by anyone after the resolution cooldown. The outcome comes from an independent consensus round with the appellant note as untrusted context. The owner cannot overturn or uphold verdicts — only rules (versioned) and thresholds are owner-governed.",
      "reclaim_appeal() after the appeal timeout returns the bond if consensus resolution never happened, so staked value can never freeze.",
    ],
  },
  {
    title: "Reputation",
    body: [
      "Reporters build reputation: honest_reports on confirmed violations, false_reports on cleared content. With ≥3 settled reports and ≥70% honesty, the required report bond drops to 80% — a deterministic on-chain formula, visible via get_reputation.",
    ],
  },
  {
    title: "SDK & API",
    body: [
      "packages/sdk — @genlayer-cm/sdk: typed read/write client, waitForFinalized with pre-broadcast retries, poll-based subscriptions.",
      "apps/api — Moderation-as-a-Service Route Handlers: GET /api/items, /api/items/:id, /api/stats, /api/reputation/:addr, POST /api/moderate (write mode needs a server key; otherwise read-only), GET /api/badge/:id.svg for embeddable verdict badges. OpenAPI at /api/openapi.json.",
      "public/embed.js — drop-in widget: <script src=\".../embed.js\" data-item-id=\"…\"></script> renders the verdict with an explorer link.",
    ],
  },
  {
    title: "Verify everything",
    body: [
      "genvm-lint check contracts/registry_v2.py",
      "pytest tests/direct (77 in-memory GenVM tests, no network)",
      "pnpm --filter @genlayer-cm/sdk test (vitest)",
      "Every on-chain claim in README links a real transaction on explorer-bradbury.genlayer.com.",
    ],
  },
];

export default function DocsPage() {
  return (
    <Shell>
      <h1 className="pt-4 text-2xl font-semibold">Documentation</h1>
      <div className="mt-6 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-medium">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
              {s.body.map((b, i) => (
                <li key={i} className="leading-relaxed">{b}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Shell>
  );
}
