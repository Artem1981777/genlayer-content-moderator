"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RegistryClient, BRADBURY } from "@genlayer-cm/sdk";
import { useWallet } from "@/components/wallet";
import { CONTRACT_ADDRESS } from "@/lib/registry";

/**
 * Write layer: signed EIP-1193 transactions through the connected wallet.
 * Retries happen ONLY before broadcast (no double-send): a failed
 * wallet_sendGenLayerTransaction may have broadcast, so we surface the error
 * to the user instead of retrying blindly — state guards make explicit
 * user-initiated retries safe.
 */
export function useRegistryWrite() {
  const { address, provider } = useWallet();
  const [pending, setPending] = useState<string | null>(null);

  const write = useCallback(
    async (fn: string, args: unknown[], value: bigint = 0n): Promise<string> => {
      if (!provider || !address) {
        toast.error("Connect your wallet first");
        throw new Error("wallet not connected");
      }
      const { createClient, createAccount } = await import("genlayer-js");
      const { testnetBradbury } = await import("genlayer-js/chains");
      const account = createAccount(); // placeholder; provider signs
      void account;
      const client = createClient({ chain: testnetBradbury, account: provider as never });
      const reg = new RegistryClient({ address: CONTRACT_ADDRESS, client: client as never });
      try {
        setPending(fn);
        const hash = await reg.write(fn, args, value);
        toast.success(fn + " finalized", {
          description: BRADBURY.explorer + "/tx/" + hash,
        });
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(fn + " failed", { description: msg.slice(0, 140) });
        throw e;
      } finally {
        setPending(null);
      }
    },
    [provider, address],
  );

  return { write, pending, connected: !!address };
}

/** Live countdown to a unix-ts deadline (network-time based). */
export function useCountdown(deadlineSec: number | null): string {
  const [now, setNow] = useState<number>(() => Date.now() / 1000);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);
  if (!deadlineSec) return "—";
  const left = deadlineSec - now;
  if (left <= 0) return "ready";
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = Math.floor(left % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
