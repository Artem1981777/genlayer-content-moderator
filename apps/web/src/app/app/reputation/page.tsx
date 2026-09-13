"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "@/components/shell";
import { useReputation, useItems } from "@/lib/registry";
import { fmtWei, short } from "@/components/registry-ui";

function Rep() {
  const params = useSearchParams();
  const addr = params.get("addr");
  const { data: rep } = useReputation(addr);
  const { data: authored } = useItems(0, 50, "");
  const items = (authedItems(addr, authored) || []).slice(0, 20);
  if (!addr) return <p className="pt-8 text-sm text-neutral-500">No address given.</p>;
  return (
    <div className="pt-2">
      <h1 className="mono text-lg font-semibold">{addr}</h1>
      {!rep && <div className="mt-4 h-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />}
      {rep && (
        <>
          <div className="mono mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["approved", rep.approved],
              ["removed", rep.removed],
              ["honest reports", rep.honest_reports],
              ["false reports", rep.false_reports],
              ["appeals won", rep.appeals_won],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="text-xs uppercase tracking-wide text-neutral-500">{k}</div>
                <div className="mt-1 text-2xl font-semibold">{String(v)}</div>
              </div>
            ))}
          </div>
          <p className="mono mt-3 text-xs text-neutral-500">
            reputation-adjusted report bond for this address: {fmtWei(rep.required_report_bond)}{" "}
            (80% discount at ≥3 reports and ≥70% honesty)
          </p>
          <h2 className="mt-8 text-sm font-medium">Authored items</h2>
          <ul className="mono mt-2 space-y-1 text-xs">
            {items.map((it) => (
              <li key={it.id}>
                <Link className="text-amber-600 hover:underline dark:text-amber-400" href={`/app/item/?id=${it.id}`}>
                  {it.id}
                </Link>{" "}
                — {it.status} {it.verdict && `· ${it.verdict}`}
              </li>
            ))}
            {items.length === 0 && <li className="text-neutral-500">no items</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function authedItems(addr: string | null, page: { items: { id: string; author: string; status: string; verdict: string }[] } | null | undefined) {
  if (!addr || !page) return null;
  return page.items.filter((i) => i.author.toLowerCase() === addr.toLowerCase());
}

export default function ReputationPage() {
  return (
    <Shell>
      <Suspense>
        <Rep />
      </Suspense>
    </Shell>
  );
}
