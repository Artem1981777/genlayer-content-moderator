import { CONTRACT_ADDRESS } from "@/lib/registry";

export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "ContentModerator API",
      version: "2.0.0",
      description:
        "Moderation-as-a-Service over the ContentModerator GenLayer Intelligent Contract (registry v2). Read endpoints are public; POST /api/moderate write mode requires the operator to configure MODERATOR_KEY.",
    },
    servers: [{ url: "/", description: "current deployment" }],
    paths: {
      "/api/items": {
        get: {
          summary: "List moderation items",
          parameters: [
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 50 } },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "paginated items" }, "429": { description: "rate limited" } },
        },
      },
      "/api/items/{id}": {
        get: {
          summary: "Fetch one item with full history",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "item" }, "404": { description: "unknown item" } },
        },
      },
      "/api/stats": { get: { summary: "Registry statistics", responses: { "200": { description: "stats" } } } },
      "/api/reputation/{addr}": {
        get: {
          summary: "Reputation of an address",
          parameters: [{ name: "addr", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "reputation" } },
        },
      },
      "/api/moderate": {
        get: {
          summary: "Look up an existing moderation by URL",
          parameters: [{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } }],
          responses: { "200": { description: "lookup result" } },
        },
        post: {
          summary: "Submit a URL for consensus moderation (write mode only)",
          requestBody: {
            content: { "application/json": { schema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] } } },
          },
          responses: { "200": { description: "moderation result" }, "403": { description: "read-only mode" } },
        },
      },
      "/api/badge/{id}.svg": {
        get: {
          summary: "Embeddable SVG verdict badge",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "image/svg+xml" } },
        },
      },
    },
    "x-contract-address": CONTRACT_ADDRESS || "(set REGISTRY_ADDRESS)",
  };
  return new Response(JSON.stringify(spec, null, 2), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
