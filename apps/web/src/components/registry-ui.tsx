"use client";

import { AXES } from "@genlayer-cm/sdk";
import type { ModerationItem, RegistryStats, Verdict } from "@genlayer-cm/sdk";

export function StatusBadge({ status }: { status: string }) {
  const color =
    status === "resolved"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "appealed"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : status === "enforced"
          ? "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300";
  return (
    <span className={`mono inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: Verdict | "" }) {
  if (!verdict) return <span className="mono text-xs text-neutral-400">—</span>;
  const color =
    verdict === "APPROVE"
      ? "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border-emerald-600/40"
      : verdict === "FLAG"
        ? "bg-amber-600/15 text-amber-600 dark:text-amber-400 border-amber-600/40"
        : "bg-red-600/15 text-red-600 dark:text-red-400 border-red-600/40";
  return (
    <span className={`mono inline-block rounded border px-2 py-0.5 text-xs font-semibold ${color}`}>
      {verdict}
    </span>
  );
}

export function short(addr: string, n = 6) {
  return addr ? `${addr.slice(0, n + 2)}…${addr.slice(-4)}` : "—";
}

export function KpiCards({ stats }: { stats: RegistryStats | null | undefined }) {
  const cards = stats
    ? [
        { label: "Items", value: stats.total },
        { label: "Pool", value: fmtWei(stats.pool) },
        { label: "Paid out", value: fmtWei(stats.payouts_sum) },
        { label: "Injections caught", value: stats.injection_caught },
      ]
    : [0, 1, 2, 3].map((i) => ({ label: "", value: i }));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c, i) => (
        <div
          key={i}
          className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
        >
          {stats ? (
            <>
              <div className="text-xs uppercase tracking-wide text-neutral-500">{c.label}</div>
              <div className="mono mt-1 text-2xl font-semibold">{String(c.value)}</div>
            </>
          ) : (
            <div className="h-10 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          )}
        </div>
      ))}
    </div>
  );
}

export function fmtWei(wei: number): string {
  if (!Number.isFinite(wei)) return "0";
  const gen = wei / 1e18;
  if (gen >= 0.001) return gen.toFixed(4) + " GEN";
  return (wei / 1e12) + "e-6 GEN";
}

export function RadarChart({ scores }: { scores: ModerationItem["scores"] }) {
  // signature element: 7-axis harm radar, pure SVG
  const size = 220;
  const c = size / 2;
  const r = 80;
  const angle = (i: number) => (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
  const pt = (i: number, v: number) => {
    const rr = (v / 100) * r;
    return [c + rr * Math.cos(angle(i)), c + rr * Math.sin(angle(i))];
  };
  const poly = AXES.map((ax, i) => pt(i, scores?.[ax] ?? 0).join(",")).join(" ");
  const ring = (v: number) =>
    AXES.map((_, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="harm axis radar">
      {[25, 50, 75, 100].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke="currentColor" className="text-neutral-300 dark:text-neutral-700" strokeWidth="1" />
      ))}
      {AXES.map((ax, i) => {
        const [x, y] = pt(i, 110);
        return (
          <text key={ax} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            className="mono fill-neutral-500 text-[9px]">
            {ax}
          </text>
        );
      })}
      <polygon points={poly} fill="rgba(217,119,6,0.25)" stroke="#d97706" strokeWidth="2" />
    </svg>
  );
}

const STEPS = ["created", "ingested", "moderated", "enforced", "appealed", "resolved"] as const;

export function StatusStepper({ status }: { status: ModerationItem["status"] }) {
  const idx = STEPS.indexOf(status);
  const appealed = STEPS.indexOf("appealed");
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {STEPS.map((s, i) => {
        // after an overturn the item lands on resolved; appealed shown as passed
        const reached = idx >= i || (status === "resolved" && i <= appealed);
        const rejected = status === "resolved" && s === "appealed";
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span className="text-neutral-400">→</span>}
            <span className={`mono rounded px-1.5 py-0.5 ${
              rejected
                ? "text-neutral-400 line-through"
                : reached
                  ? "bg-amber-600 text-white"
                  : "text-neutral-400"
            }`}>
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function HistoryTimeline({ item }: { item: ModerationItem }) {
  return (
    <ol className="space-y-2">
      {[...item.history].reverse().map((h) => (
        <li key={h.n} className="flex gap-3 text-sm">
          <span className="mono w-24 shrink-0 text-neutral-500">
            {new Date(h.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}
          </span>
          <span className="mono w-32 shrink-0 font-medium text-amber-600 dark:text-amber-400">
            {h.action}
          </span>
          <span className="min-w-0">
            <span className="mono text-neutral-500">{short(h.by)} </span>
            {h.note}
          </span>
        </li>
      ))}
    </ol>
  );
}
