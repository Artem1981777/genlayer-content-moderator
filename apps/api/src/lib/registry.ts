import { RegistryClient } from "@genlayer-cm/sdk";

/** Server-side registry access. Read-only unless MODERATOR_KEY is provided. */
export const CONTRACT_ADDRESS = process.env.REGISTRY_ADDRESS ?? "";

let cached: RegistryClient | null = null;

export async function registry(): Promise<RegistryClient | null> {
  if (!CONTRACT_ADDRESS) return null;
  if (cached) return cached;
  const { createClient, createAccount } = await import("genlayer-js");
  const { testnetBradbury } = await import("genlayer-js/chains");
  const key = process.env.MODERATOR_KEY; // optional service write key
  const account = key ? createAccount(key as `0x${string}`) : undefined;
  const client = createClient({ chain: testnetBradbury, account });
  cached = new RegistryClient({ address: CONTRACT_ADDRESS, client: client as never });
  return cached;
}

export const writeMode = !!process.env.MODERATOR_KEY;

// --- tiny in-memory rate limiter (per IP, sliding window) ---
const buckets = new Map<string, number[]>();

export function rateLimit(ip: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(ip, arr);
  if (buckets.size > 10_000) buckets.clear(); // crude memory bound
  return arr.length <= limit;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function json(data: unknown, status = 200, cache = 15): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${cache}`,
      "access-control-allow-origin": "*",
    },
  });
}

export function err(status: number, message: string): Response {
  return json({ error: message }, status, 0);
}
