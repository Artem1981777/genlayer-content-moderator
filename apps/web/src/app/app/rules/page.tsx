"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { useConfig, useRules } from "@/lib/registry";
import { useRegistryWrite } from "@/hooks/use-registry-write";
import { useWallet } from "@/components/wallet";
import { AXES } from "@genlayer-cm/sdk";

export default function RulesPage() {
  const { data: config } = useConfig();
  const { data: rules } = useRules(config?.rules_version ?? null);
  const { address } = useWallet();
  const { write, pending } = useRegistryWrite();
  const [text, setText] = useState("");
  const [axis, setAxis] = useState<string>("scam");
  const [flagBps, setFlagBps] = useState(5000);
  const [removeBps, setRemoveBps] = useState(8000);
  const isOwner = !!config && !!address && address.toLowerCase() === config.owner.toLowerCase();

  return (
    <Shell>
      <h1 className="pt-4 text-2xl font-semibold">Community rules</h1>
      {!rules && <div className="mt-4 h-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />}
      {rules && (
        <>
          <p className="mono mt-2 text-xs text-neutral-500">
            version {rules.version} · set {new Date(rules.set_ts * 1000).toISOString().slice(0, 16).replace("T", " ")}
          </p>
          <p className="mt-3 max-w-3xl rounded-lg border border-neutral-200 bg-white p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            {rules.text}
          </p>
          <table className="mono mt-4 w-full max-w-xl text-xs">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1">axis</th>
                <th className="py-1">FLAG from</th>
                <th className="py-1">REMOVE from</th>
              </tr>
            </thead>
            <tbody>
              {AXES.map((ax) => (
                <tr key={ax} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1">{ax}</td>
                  <td className="py-1">{rules.flag_bp[ax] ?? 5000} bps</td>
                  <td className="py-1">{rules.remove_bp[ax] ?? 8000} bps</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 max-w-xl text-xs text-neutral-500">
            A top-axis score s maps to REMOVE when s·100 ≥ remove_bp, FLAG when s·100 ≥ flag_bp,
            APPROVE otherwise. Thresholds are owner-governed and snapshotted into each rules version.
          </p>
        </>
      )}

      <h2 className="mt-10 text-lg font-medium">Owner maintenance</h2>
      {!isOwner && (
        <p className="mt-2 text-sm text-neutral-500">
          Connect the owner wallet to edit rules and thresholds — verdicts stay out of owner reach
          by design.
        </p>
      )}
      {isOwner && (
        <div className="mt-3 max-w-2xl space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="rules-text">New rules text</label>
            <textarea
              id="rules-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
            <button
              onClick={() => write("set_rules", [text]).then(() => toast.success("rules version bumped")).catch(() => {})}
              disabled={!text.trim() || !!pending}
              className="mono mt-2 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              set_rules (bumps version)
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              axis
              <select
                value={axis}
                onChange={(e) => setAxis(e.target.value)}
                className="mono ml-2 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
              >
                {AXES.map((ax) => <option key={ax}>{ax}</option>)}
              </select>
            </label>
            <label className="mono text-xs">
              flag bps
              <input type="number" value={flagBps} onChange={(e) => setFlagBps(Number(e.target.value))}
                className="ml-2 w-24 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" />
            </label>
            <label className="mono text-xs">
              remove bps
              <input type="number" value={removeBps} onChange={(e) => setRemoveBps(Number(e.target.value))}
                className="ml-2 w-24 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700" />
            </label>
            <button
              onClick={() => write("set_thresholds", [axis, flagBps, removeBps]).catch(() => {})}
              disabled={!!pending}
              className="mono rounded border border-amber-600 px-3 py-1.5 text-xs font-medium text-amber-600 disabled:opacity-50"
            >
              set_thresholds
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
