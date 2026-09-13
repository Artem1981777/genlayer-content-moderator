import { registry, json, err, rateLimit, clientIp } from "@/lib/registry";

export const revalidate = 15;

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req))) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  const status = url.searchParams.get("status") ?? "";
  try {
    return json(await reg.getAllItems(offset, limit, status));
  } catch (e) {
    return err(502, String(e instanceof Error ? e.message : e).slice(0, 200));
  }
}
