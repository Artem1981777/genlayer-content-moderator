"use client";

import { Shell } from "@/components/shell";
import { useStats, useConfig } from "@/lib/registry";
import { KpiCards } from "@/components/registry-ui";
import Link from "next/link";
import { ArrowRight, Gavel, Landmark, ShieldCheck } from "lucide-react";

const HOW = [
  {
    icon: Gavel,
    title: "Consensus verdicts",
    body: "Every verdict comes from independent validators running the same three-step pass — fetch the live page, extract the content, score 7 harm axes — and agree by code-defined tolerance, not by trusting one LLM.",
  },
  {
    icon: Landmark,
    title: "Skin in the game",
    body: "Authors stake on ingest, reporters bond on reports, appellants bond on appeals. False reporters pay the author; honest reporters share forfeited stakes; the pool funds rewards.",
  },
  {
    icon: ShieldCheck,
    title: "Owner can't overturn",
    body: "Appeals are resolved by a fresh validator consensus round, permissionlessly, after a cooldown. The owner only maintains rules and parameters — never verdicts.",
  },
];

export default function Home() {
  const { data: stats } = useStats();
  const { data: config } = useConfig();
  return (
    <Shell>
      <section className="py-14">
        <p className="mono text-sm uppercase tracking-widest text-amber-600 dark:text-amber-400">
          Intelligent Contract · GenLayer Bradbury
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
          Content moderation decided by{" "}
          <span className="text-amber-600 dark:text-amber-400">validator consensus</span>, not by a
          single moderator.
        </h1>
        <p className="mt-4 max-w-2xl text-neutral-600 dark:text-neutral-400">
          ContentModerator fetches the live source, scores it against on-chain community rules with
          an AI panel, enforces the verdict with real stakes — and lets anyone trigger a consensus
          appeal review.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/app/"
            className="mono flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            Open registry <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/app/submit/"
            className="mono flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
          >
            Submit content
          </Link>
        </div>
      </section>

      <section className="py-6">
        <KpiCards stats={stats} />
      </section>

      <section className="grid gap-4 py-8 md:grid-cols-3">
        {HOW.map((h) => (
          <div
            key={h.title}
            className="rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h.icon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h2 className="mt-3 font-medium">{h.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {h.body}
            </p>
          </div>
        ))}
      </section>

      {config && (
        <section className="mono rounded-lg border border-neutral-200 p-4 text-xs text-neutral-500 dark:border-neutral-800">
          rules v{config.rules_version} · min stake {String(config.min_stake)} wei · report bond{" "}
          {String(config.report_bond)} wei · appeal bond {String(config.appeal_bond)} wei · owner{" "}
          {short(config.owner)}
        </section>
      )}
    </Shell>
  );
}
