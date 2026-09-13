"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { useConfig, getBrowserRegistry } from "@/lib/registry";
import { useRegistryWrite } from "@/hooks/use-registry-write";
import { useWallet } from "@/components/wallet";
import { VerdictBadge } from "@/components/registry-ui";
import type { ModerationItem } from "@genlayer-cm/sdk";

const STEPS = ["URL", "Stake", "Consensus"] as const;

export default function SubmitPage() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<(typeof STEPS)[number]>("URL");
  const [itemId, setItemId] = useState<string | null>(null);
  const [result, setResult] = useState<ModerationItem | null>(null);
  const { data: config } = useConfig();
  const { write, pending } = useRegistryWrite();
  const { address } = useWallet();
  const router = useRouter();

  const valid = /^https?:\/\/.{1,500}$/.test(url.trim());

  async function start() {
    if (!address) {
      toast.error("Connect your wallet first — ingest is author-signed");
      return;
    }
    try {
      setStep("Stake");
      const id = await write("create_item", [""]);
      const stake = BigInt(config?.min_stake ?? 10 ** 12);
      await write("ingest", [id, url.trim()], stake);
      setItemId(id);
      setStep("Consensus");
      await write("moderate", [id]);
      const reg = await getBrowserRegistry();
      const item = reg ? await reg.getItem(id) : null;
      setResult(item);
    } catch {
      // toasts already surfaced by useRegistryWrite
    }
  }

  return (
    <Shell>
      <h1 className="pt-4 text-2xl font-semibold">Submit content for moderation</h1>
      <ol className="mono mt-4 flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-neutral-400">→</span>}
            <span className={`rounded px-2 py-1 ${step === s ? "bg-amber-600 text-white" : "bg-neutral-200 text-neutral-500 dark:bg-neutral-800"}`}>
              {s}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6 max-w-2xl space-y-4">
        <div>
          <label htmlFor="url" className="text-sm font-medium">
            Public URL of the content
          </label>
          <input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/post"
            className="mono mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
          {!valid && url && (
            <p className="mt-1 text-xs text-red-600">http(s) only, max 512 characters.</p>
          )}
        </div>
        <div className="mono text-xs text-neutral-500">
          you will lock a stake of {String(config?.min_stake ?? 10 ** 12)} wei; validators fetch this
          URL, extract the content and score it — consensus decides.
        </div>
        <button
          onClick={start}
          disabled={!valid || !!pending}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {pending ?? "Submit for moderation"}
        </button>

        {result && (
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-center gap-3">
              <VerdictBadge verdict={result.verdict} />
              <span className="mono text-xs text-neutral-500">confidence {result.confidence}</span>
            </div>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{result.reason}</p>
            <Link href={`/app/item/?id=${result.id}`} className="mono mt-2 inline-block text-xs text-amber-600 hover:underline dark:text-amber-400">
              open item {result.id}
            </Link>
          </div>
        )}
      </div>
    </Shell>
  );
}
