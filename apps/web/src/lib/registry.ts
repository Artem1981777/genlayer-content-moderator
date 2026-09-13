"use client";

import useSWR from "swr";
import { RegistryClient, BRADBURY } from "@genlayer-cm/sdk";
import type { ItemsPage, ModerationItem, RegistryConfig, RegistryStats, Reputation, RuleSetView, PayoutsPage } from "@genlayer-cm/sdk";

/**
 * Read layer: browser -> Bradbury RPC -> registry_v2 via genlayer-js + the SDK.
 * No mocks: every value rendered by the dApp comes from the contract.
 */

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? ""; // set at deploy time

let cached: RegistryClient | null = null;

export async function getBrowserRegistry(): Promise<RegistryClient | null> {
  if (!CONTRACT_ADDRESS) return null;
  if (cached) return cached;
  const { createClient } = await import("genlayer-js");
  const { testnetBradbury } = await import("genlayer-js/chains");
  const client = createClient({ chain: testnetBradbury });
  cached = new RegistryClient({ address: CONTRACT_ADDRESS, client: client as never });
  return cached;
}

// ---------------------------------------------------------------- SWR hooks
const fetcher = async (key: readonly string[]): Promise<unknown> => {
  const reg = await getBrowserRegistry();
  if (!reg) return null;
  const [fn, ...rest] = key;
  switch (fn) {
    case "stats":
      return reg.getStats();
    case "config":
      return reg.getConfig();
    case "items":
      return reg.getAllItems(Number(rest[0] ?? 0), Number(rest[1] ?? 20), rest[2] ?? "");
    case "item":
      return reg.getItem(rest[0]);
    case "reputation":
      return reg.getReputation(rest[0]);
    case "rules":
      return reg.getRules(Number(rest[0] ?? 1));
    case "payouts":
      return reg.getPayouts(Number(rest[0] ?? 0), Number(rest[1] ?? 50));
    default:
      return null;
  }
};

export function useStats() {
  return useSWR<RegistryStats | null>(["stats"], fetcher as never, { refreshInterval: 7000 });
}

export function useConfig() {
  return useSWR<RegistryConfig | null>(["config"], fetcher as never, { refreshInterval: 15000 });
}

export function useItems(offset = 0, limit = 20, statusFilter = "") {
  return useSWR<ItemsPage | null>(
    ["items", String(offset), String(limit), statusFilter],
    fetcher as never,
    { refreshInterval: 7000 },
  );
}

export function useItem(itemId: string | null) {
  return useSWR<ModerationItem | null>(itemId ? ["item", itemId] : null, fetcher as never, {
    refreshInterval: 7000,
  });
}

export function useReputation(addr: string | null) {
  return useSWR<Reputation | null>(addr ? ["reputation", addr] : null, fetcher as never, {
    refreshInterval: 10000,
  });
}

export function useRules(version: number | null) {
  return useSWR<RuleSetView | null>(version ? ["rules", String(version)] : null, fetcher as never);
}

export function usePayouts(offset = 0, limit = 50) {
  return useSWR<PayoutsPage | null>(
    ["payouts", String(offset), String(limit)],
    fetcher as never,
    { refreshInterval: 10000 },
  );
}
