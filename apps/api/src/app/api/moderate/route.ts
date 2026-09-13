import { registry, writeMode, json, err, rateLimit, clientIp } from "@/lib/registry";

/**
 * POST /api/moderate  { url }
 * Write mode (MODERATOR_KEY set): create -> ingest+stake -> moderate and
 * return the consensus verdict. Read-only mode: 403 with guidance.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 10)) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  if (!writeMode) {
    return err(403, "service runs read-only (no MODERATOR_KEY configured); ingest via the dApp or the SDK with your own key");
  }
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return err(400, "invalid JSON body");
  }
  const url = (body.url ?? "").trim();
  if (!/^https?:\/\/.{1,500}$/.test(url)) {
    return err(400, "url must be http(s) and at most ~500 characters");
  }
  try {
    const existing = await reg.getItemIdByUrl(url);
    if (existing) return json({ item_id: existing, reused: true });
    const config = await reg.getConfig();
    const item_id = await reg.createItem("");
    await reg.ingest(item_id, url, BigInt(config.min_stake));
    await reg.moderate(item_id);
    const item = await reg.getItem(item_id);
    return json({ item_id, verdict: item?.verdict, reason: item?.reason, scores: item?.scores });
  } catch (e) {
    return err(502, String(e instanceof Error ? e.message : e).slice(0, 200));
  }
}

/** GET /api/moderate?url= — read-only lookup of an existing moderation. */
export async function GET(req: Request) {
  if (!rateLimit(clientIp(req))) return err(429, "rate limit exceeded");
  const reg = await registry();
  if (!reg) return err(503, "REGISTRY_ADDRESS not configured");
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url) return err(400, "url query parameter required");
  const item_id = await reg.getItemIdByUrl(url);
  if (!item_id) return json({ item_id: null }, 200, 5);
  const item = await reg.getItem(item_id);
  return json({ item_id, item }, 200, 5);
}
