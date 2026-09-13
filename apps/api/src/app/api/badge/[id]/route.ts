import { registry } from "@/lib/registry";

/** GET /api/badge/:id.svg — embeddable verdict badge for third-party sites. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const reg = await registry();
  const { id } = await ctx.params;
  let label = "unverified";
  let color = "#737373";
  if (reg) {
    try {
      const item = await reg.getItem(id);
      if (item?.verdict === "APPROVE") { label = "APPROVED by GenLayer"; color = "#059669"; }
      else if (item?.verdict === "FLAG") { label = "FLAGGED by GenLayer"; color = "#d97706"; }
      else if (item?.verdict === "REMOVE") { label = "REMOVED by GenLayer"; color = "#dc2626"; }
      else if (item) label = "status: " + item.status;
    } catch {
      label = "lookup failed";
    }
  }
  const width = 30 + label.length * 7.2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" role="img" aria-label="${label}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <rect rx="4" width="${width}" height="24" fill="#1c1917"/>
  <rect rx="4" width="${width}" height="24" fill="url(#s)"/>
  <circle cx="12" cy="12" r="4" fill="${color}"/>
  <text x="22" y="16" fill="#fafafa" font-family="ui-monospace,monospace" font-size="11">${label} · ${id.slice(0, 8)}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}
