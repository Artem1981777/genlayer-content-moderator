import { registry, json, err, rateLimit, clientIp } from "@/lib/registry";

export async function GET(req: Request, ctx: { params: Promise<{ addr: string }> }) {
  if (!rateLimit(clientIp(req))) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  const { addr } = await ctx.params;
  try {
    return json(await reg.getReputation(addr));
  } catch (e) {
    return err(502, String(e instanceof Error ? e.message : e).slice(0, 200));
  }
}
