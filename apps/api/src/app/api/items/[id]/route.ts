import { registry, json, err, rateLimit, clientIp } from "@/lib/registry";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!rateLimit(clientIp(req))) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  const { id } = await ctx.params;
  try {
    const item = await reg.getItem(id);
    if (!item) return err(404, "unknown item");
    return json(item);
  } catch (e) {
    return err(502, String(e instanceof Error ? e.message : e).slice(0, 200));
  }
}
