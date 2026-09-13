import { describe, it, expect, vi } from "vitest";
import { RegistryClient } from "../src/client.js";
import type { ModerationItem } from "../src/types.js";

function makeItem(overrides: Partial<ModerationItem> = {}): ModerationItem {
  const base: ModerationItem = {
    id: "abc123",
    source: "https://example.test/x",
    url_hash: "0".repeat(64),
    creator: "0x" + "aa".repeat(20),
    author: "0x" + "aa".repeat(20),
    reporter: "",
    rules_version: 1,
    status: "moderated",
    verdict: "APPROVE",
    reason: "clean",
    category: "scam",
    confidence: 90,
    severity: "none",
    scores: { scam: 0, spam: 0, harassment: 0, hate: 0, violence: 0, sexual: 0, self_harm: 0 },
    injection_attempt: 0,
    injection_detected: false,
    needs_review: false,
    enforced: false,
    blocked: false,
    limited: false,
    enforcement_action: "none",
    appeal_note: "",
    appeal_outcome: "",
    author_stake: 1_000_000_000_000,
    reporter_bond: 0,
    appeal_stake: 0,
    forfeited: 0,
    stake_outcome: "",
    content: "hello",
    content_hash: "0".repeat(64),
    created_ts: 1_700_000_000,
    verdict_ts: 1_700_000_100,
    appeal_ts: 0,
    last_llm_ts: 0,
    history: [{ n: 0, action: "create_item", by: "0x" + "aa".repeat(20), ts: 1_700_000_000, note: "Item created" }],
  };
  return { ...base, ...overrides } as ModerationItem;
}

const NEW_TX_TOPIC = "0xdab9102861c7483a187584d6371d88316f005af507982ccf95c110879f3ed5a5";
const EVM_HASH = ("0x" + "ee".repeat(32));
const GEN_TXID = ("0x" + "ff".repeat(32));

function flatRequestMock() {
  return vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_gasPrice") return "0x1";
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_estimateGas") return "0x100000";
    if (method === "eth_sendRawTransaction") return EVM_HASH;
    if (method === "eth_getTransactionReceipt") {
      return {
        status: "0x1",
        logs: [{
          address: "0x0112bf6e83497965a5fdd6dad1e447a6e004271d",
          topics: [NEW_TX_TOPIC, GEN_TXID, "0x" + "11".repeat(32), "0x" + "22".repeat(32)],
          data: "0x",
        }],
      };
    }
    throw new Error("unexpected rpc " + method);
  });
}

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    readContract: vi.fn(async ({ functionName, args }) => {
      if (functionName === "get_item") {
        const item = makeItem({ id: args[0] as string });
        return JSON.stringify(item);
      }
      if (functionName === "get_all_items") {
        const [offset, limit] = args as number[];
        return JSON.stringify({
          offset, limit, total: 3,
          items: [makeItem({ id: "a" + offset }), makeItem({ id: "b" + offset })],
        });
      }
      if (functionName === "get_config") {
        return JSON.stringify({
          owner: "0x" + "11".repeat(20), default_rules: "rules", min_stake: 1e12,
          report_bond: 1e12, appeal_bond: 2e12, enforce_timeout_sec: 86400,
          appeal_resolve_cooldown_sec: 3600, appeal_timeout_sec: 172800,
          llm_cooldown_sec: 60, max_open_reports: 3, max_open_appeals: 2,
          pool: 0, item_count: 3, rules_version: 1,
          flag_bp: {}, remove_bp: {},
        });
      }
      if (functionName === "get_stats") {
        return JSON.stringify({ total: 3, by_status: { enforced: 3 }, by_verdict: { APPROVE: 3 }, total_staked: 0, payouts_sum: 0, pool: 0, injection_caught: 0 });
      }
      if (functionName === "verify_content") return true;
      if (functionName === "read_content") return "hello";
      if (functionName === "get_item_by_url") return "";
      return "";
    }),
    writeContract: vi.fn(async () => "0x" + "ff".repeat(32)),
    waitForTransactionReceipt: vi.fn(async () => ({})),
    getTransaction: vi.fn(async () => ({ txExecutionResultName: "FINISHED" })),
    account: { address: "0x" + "33".repeat(20), signTransaction: vi.fn(async () => ("0x" + "dd".repeat(40))) },
    request: flatRequestMock(),
    ...overrides,
  };
}

const ADDR = "0x" + "22".repeat(20);

describe("RegistryClient", () => {
  it("parses get_item JSON into a typed item", async () => {
    const c = new RegistryClient({ address: ADDR, client: mockClient() as never });
    const item = await c.getItem("abc123");
    expect(item).not.toBeNull();
    expect(item!.id).toBe("abc123");
    expect(item!.scores.scam).toBe(0);
    expect(item!.history).toHaveLength(1);
  });

  it("returns null for unknown item (empty string view)", async () => {
    const mc = mockClient();
    mc.readContract = vi.fn(async () => "");
    const c = new RegistryClient({ address: ADDR, client: mc as never });
    expect(await c.getItem("nope")).toBeNull();
  });

  it("parses config and stats", async () => {
    const c = new RegistryClient({ address: ADDR, client: mockClient() as never });
    const cfg = await c.getConfig();
    expect(cfg.min_stake).toBe(1e12);
    expect(cfg.owner).toMatch(/^0x/);
    const stats = await c.getStats();
    expect(stats.total).toBe(3);
  });

  it("paginates get_all_items", async () => {
    const mc = mockClient();
    const c = new RegistryClient({ address: ADDR, client: mc as never });
    const page = await c.getAllItems(2, 20);
    expect(page.offset).toBe(2);
    expect(mc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "get_all_items", args: [2, 20, ""] }),
    );
  });

  it("write waits for finality and returns the GenLayer tx id", async () => {
    const mc = mockClient();
    const c = new RegistryClient({ address: ADDR, client: mc as never });
    const h = await c.moderate("abc123");
    expect(h).toBe(GEN_TXID);
    expect(mc.getTransaction).toHaveBeenCalled();
  }, 30_000);

  it("write attaches value as the AddTransaction EVM msg.value", async () => {
    const mc = mockClient();
    const c = new RegistryClient({ address: ADDR, client: mc as never });
    await c.ingest("id", "https://x", 1_000_000_000_000n);
    expect(mc.account.signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1_000_000_000_000n }),
    );
  }, 30_000);

  it("retries transient -32005 errors before finality", async () => {
    const mc = mockClient();
    let calls = 0;
    mc.getTransaction = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("RPC error -32005 capacity");
      return { txExecutionResultName: "FINISHED" };
    });
    const c = new RegistryClient({ address: ADDR, client: mc as never, retries: 5 });
    const h = await c.moderate("x");
    expect(h).toContain("ff");
    expect(mc.getTransaction).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("throws on failed execution status", async () => {
    const mc = mockClient();
    mc.getTransaction = vi.fn(async () => ({ txExecutionResultName: "FINISHED_WITH_ERROR" }));
    const c = new RegistryClient({ address: ADDR, client: mc as never, retries: 2 });
    await expect(c.moderate("x")).rejects.toThrow(/failed/);
  }, 30_000);

  it("does not retry non-transient errors", async () => {
    const mc = mockClient();
    mc.request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_sendRawTransaction") throw new Error("insufficient funds");
      if (method === "eth_gasPrice") return "0x1";
      if (method === "eth_getTransactionCount") return "0x1";
      if (method === "eth_estimateGas") return "0x100000";
      throw new Error("unexpected rpc " + method);
    });
    const c = new RegistryClient({ address: ADDR, client: mc as never, retries: 5 });
    await expect(c.ingest("id", "https://x", 1n)).rejects.toThrow(/insufficient funds/);
    expect(mc.request).toHaveBeenCalledTimes(4);
  });

  it("subscribe fires on snapshot change and stops on unsubscribe", async () => {
    const mc = mockClient();
    let version = 0;
    mc.readContract = vi.fn(async ({ functionName }) => {
      if (functionName === "get_all_items") {
        return JSON.stringify({
          offset: 0, limit: 50, total: 1,
          items: [makeItem({ id: "it", verdict: version === 0 ? "APPROVE" : "REMOVE" })],
        });
      }
      return "";
    });
    const c = new RegistryClient({ address: ADDR, client: mc as never });
    const seen: number[] = [];
    const unsub = c.subscribe((page) => seen.push(page.total), { intervalMs: 5 });
    await new Promise((r) => setTimeout(r, 30)); // first tick -> initial snapshot
    version = 1;
    await new Promise((r) => setTimeout(r, 30)); // next tick -> change detected
    expect(seen.length).toBe(2);
    unsub();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.length).toBe(2); // no more ticks
  }, 30_000);
});
