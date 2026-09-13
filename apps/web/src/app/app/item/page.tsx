"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "@/components/shell";
import { useItem, useConfig } from "@/lib/registry";
import { RadarChart, StatusStepper, VerdictBadge, HistoryTimeline, short, fmtWei } from "@/components/registry-ui";
import { useRegistryWrite, useCountdown } from "@/hooks/use-registry-write";
import { useWallet } from "@/components/wallet";
import { toast } from "sonner";

function Detail() {
  const params = useSearchParams();
  const id = params.get("id");
  const { data: item, error } = useItem(id);
  const { data: config } = useConfig();
  const { address } = useWallet();
  const { write, pending } = useRegistryWrite();
  const [note, setNote] = useState("");

  const role = useMemo(() => {
    if (!item || !address) return "anyone";
    if (address.toLowerCase() === item.author.toLowerCase()) return "author";
    if (address.toLowerCase() === item.reporter.toLowerCase()) return "reporter";
    if (config && address.toLowerCase() === config.owner.toLowerCase()) return "owner";
    return "anyone";
  }, [item, address, config]);

  const enforceDeadline = item?.verdict_ts
    ? (config ? item.verdict_ts + config.enforce_timeout_sec : null)
    : null;
  const resolveDeadline = item?.appeal_ts
    ? (config ? item.appeal_ts + config.appeal_resolve_cooldown_sec : null)
    : null;
  const enforceIn = useCountdown(enforceDeadline);
  const resolveIn = useCountdown(resolveDeadline);

  if (!id) return <p className="pt-8 text-sm text-neutral-500">No item id — open one from the registry.</p>;
  if (error) return <p className="pt-8 text-sm text-red-600">{String(error).slice(0, 160)}</p>;
  if (!item)
    return <div className="mt-8 h-64 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />;

  const act = (fn: string, args: unknown[], value?: bigint) => () =>
    write(fn, args, value).catch(() => {});

  const guard = (msg: string) => () => toast.info(msg);

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mono text-xl font-semibold">{item.id}</h1>
        <VerdictBadge verdict={item.verdict} />
        <span className="mono text-xs text-neutral-500">rules v{item.rules_version}</span>
      </div>
      <p className="mono mt-1 max-w-3xl break-all text-xs text-neutral-500">{item.source}</p>
      <div className="mt-3">
        <StatusStepper status={item.status} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col items-center rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <RadarChart scores={item.scores} />
          <div className="mono mt-3 w-full space-y-1 text-xs text-neutral-500">
            <div>confidence: <span className="text-neutral-800 dark:text-neutral-200">{item.confidence}</span></div>
            <div>injection attempt: <span className={(item.injection_detected ? "text-red-500" : "") + " text-neutral-800 dark:text-neutral-200"}>{item.injection_attempt}</span></div>
            <div>stake outcome: <span className="text-neutral-800 dark:text-neutral-200">{item.stake_outcome || "—"}</span></div>
            <div>forfeited: {fmtWei(item.forfeited)}</div>
            <div>content hash: {item.content_hash.slice(0, 10)}…</div>
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-medium">AI verdict</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {item.reason || "—"}
            </p>
            {item.content && (
              <p className="mono mt-3 max-h-32 overflow-y-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">
                {item.blocked
                  ? "[content removed by moderation]"
                  : item.limited
                    ? item.content
                    : item.content}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-medium">Actions</h2>
            <p className="mono mt-1 text-xs text-neutral-500">your role: {role}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {item.status === "created" && (
                <button onClick={act("ingest", [item.id, item.source || "https://example.test/post"], BigInt(item.author_stake || 10 ** 12))}
                  disabled={!!pending} className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                  ingest + stake
                </button>
              )}
              {item.status === "ingested" && (
                <button onClick={act("moderate", [item.id])} disabled={!!pending}
                  className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                  run consensus moderate
                </button>
              )}
              {item.status === "moderated" && role === "owner" && (
                <button onClick={act("enforce", [item.id])} disabled={!!pending}
                  className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                  enforce (owner)
                </button>
              )}
              {item.status === "moderated" && role !== "owner" && (
                <button onClick={guard(`Permissionless after the verdict timeout · ${enforceIn}`)}
                  className="mono rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700">
                  enforce in {enforceIn}
                </button>
              )}
              {(item.status === "moderated" || item.status === "ingested") && role === "anyone" && (
                <button onClick={act("report", [item.id], BigInt(config?.report_bond ?? 10 ** 12))}
                  disabled={!!pending}
                  className="rounded border border-amber-600 px-3 py-1.5 font-medium text-amber-600 disabled:opacity-50">
                  report (bond {fmtWei(config?.report_bond ?? 0)})
                </button>
              )}
              {item.status === "enforced" && role === "author" && item.appeal_outcome !== "overturned" && (
                <div className="flex w-full flex-col gap-2 sm:flex-row">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="appeal note (why is this verdict wrong?)"
                    className="mono min-w-0 flex-1 rounded border border-neutral-300 bg-transparent px-3 py-1.5 text-xs dark:border-neutral-700"
                  />
                  <button onClick={() => write("appeal", [item.id, note], BigInt(config?.appeal_bond ?? 2e12)).catch(() => {})}
                    disabled={!!pending || !note.trim()}
                    className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                    appeal ({fmtWei(config?.appeal_bond ?? 0)})
                  </button>
                </div>
              )}
              {item.status === "appealed" && (
                <button onClick={guard(`Consensus resolution unlocks in ${resolveIn} · anyone may trigger it`)}
                  className="mono rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700">
                  resolve in {resolveIn}
                </button>
              )}
              {item.status === "appealed" && resolveIn === "ready" && (
                <button onClick={act("resolve_appeal", [item.id])} disabled={!!pending}
                  className="rounded bg-amber-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
                  resolve by consensus (permissionless)
                </button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-medium">Timeline</h2>
            <div className="mt-3">
              <HistoryTimeline item={item} />
            </div>
          </section>

          <p className="mono text-xs text-neutral-400">
            author {short(item.author)} · reporter {short(item.reporter)} ·{" "}
            <Link className="underline" href={`/app/reputation/?addr=${item.author}`}>
              author reputation
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ItemPage() {
  return (
    <Shell>
      <Suspense>
        <Detail />
      </Suspense>
    </Shell>
  );
}
