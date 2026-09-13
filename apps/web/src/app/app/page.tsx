"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { useItems } from "@/lib/registry";
import { KpiCards, StatusBadge, VerdictBadge, short } from "@/components/registry-ui";
import { useStats } from "@/lib/registry";

const FILTERS = ["", "created", "ingested", "moderated", "enforced", "appealed", "resolved"];

function Table() {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useItems(offset, 20, status);
  const limit = 20;
  return (
    <div className="mt-6">
      <div className="mono flex flex-wrap gap-1 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            onClick={() => {
              setStatus(f);
              setOffset(0);
            }}
            className={`rounded px-2 py-1 ${
              status === f
                ? "bg-amber-600 text-white"
                : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {f || "all"}
          </button>
        ))}
      </div>
      {isLoading && <div className="mt-6 h-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />}
      {error && (
        <p className="mt-6 text-sm text-red-600">
          Failed to read the contract: {String(error).slice(0, 140)}
        </p>
      )}
      {data && (
        <>
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2">Top axis</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Author</th>
                  <th className="px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const top = Object.entries(it.scores).sort((a, b) => b[1] - a[1])[0];
                  return (
                    <tr key={it.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="px-3 py-2">
                        <Link
                          href={`/app/item/?id=${it.id}`}
                          className="mono font-medium text-amber-600 hover:underline dark:text-amber-400"
                        >
                          {it.id}
                        </Link>
                        <div className="max-w-56 truncate text-xs text-neutral-500">{it.source}</div>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={it.status} /></td>
                      <td className="px-3 py-2"><VerdictBadge verdict={it.verdict} /></td>
                      <td className="mono px-3 py-2 text-xs">
                        {top && top[1] > 0 ? `${top[0]} ${top[1]}` : "—"}
                      </td>
                      <td className="mono px-3 py-2 text-xs">{it.confidence}</td>
                      <td className="mono px-3 py-2 text-xs text-neutral-500">{short(it.author)}</td>
                      <td className="mono px-3 py-2 text-xs text-neutral-500">{it.stake_outcome || "—"}</td>
                    </tr>
                  );
                })}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                      No items yet — submit the first one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mono mt-3 flex items-center justify-between text-xs text-neutral-500">
            <span>
              {data.total} total · showing {data.offset + 1}–{Math.min(data.offset + limit, data.total)}
            </span>
            <span className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
              >
                prev
              </button>
              <button
                disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
                className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700"
              >
                next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function RegistryPage() {
  const { data: stats } = useStats();
  return (
    <Shell>
      <h1 className="pt-4 text-2xl font-semibold">Registry explorer</h1>
      <div className="mt-4">
        <KpiCards stats={stats} />
      </div>
      <Suspense>
        <Table />
      </Suspense>
    </Shell>
  );
}
