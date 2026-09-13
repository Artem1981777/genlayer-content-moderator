import { registry, json, err, rateLimit, clientIp } from "@/lib/registry";

export const revalidate = 10;

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req))) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  try {
    return json(await reg.getStats());
  } catch (e) {
    return err(502, String(e instanceof Error ? e.message : e).slice(0, 200));
  }
}
