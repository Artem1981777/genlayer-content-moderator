/**
 * Typed client for the ContentModerator registry v2 Intelligent Contract.
 *
 * Wraps genlayer-js: JSON view parsing into domain types, waitForFinalized
 * with pre-broadcast-only retries (-32005 / rate limit), and an event-less
 * state subscription via polling (GenLayer has no log events in v2; history
 * entries inside items serve as the audit trail).
 */
import type {
  BatchResult,
  ItemsPage,
  ModerationItem,
  RegistryConfig,
  RegistryStats,
  Reputation,
  RuleSetView,
} from "./types";

export interface GenLayerClientLike {
  readContract(args: {
    address: string;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;
  writeContract(args: {
    address: string;
    functionName: string;
    args?: unknown[];
    value?: bigint;
  }): Promise<string>;
  waitForTransactionReceipt(args: {
    hash: string;
    status: unknown;
    retries?: number;
  }): Promise<unknown>;
  getTransaction(args: { hash: string }): Promise<{
    txExecutionResultName?: string;
  } | null>;
}

export interface RegistryClientOptions {
  /** Contract address (0x-prefixed). */
  address: string;
  /** genlayer-js client bound to a chain (and account for writes). */
  client: GenLayerClientLike;
  /** TransactionStatus.ACCEPTED from genlayer-js/types. Default: 1. */
  acceptedStatus?: unknown;
  retries?: number;
}

const RETRIABLE = [
  "-32005",
  "capacity",
  "rate limit",
  "exceeds defined limit",
  "consensus contract",
  "evm tx",
  "fetch failed",
  "timeout",
  "not_voted",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetriable(msg: string): boolean {
  const m = msg.toLowerCase();
  return RETRIABLE.some((t) => m.includes(t));
}

export class RegistryClient {
  readonly address: string;
  private readonly client: GenLayerClientLike;
  private readonly acceptedStatus: unknown;
  private readonly retries: number;

  constructor(opts: RegistryClientOptions) {
    this.address = opts.address;
    this.client = opts.client;
    this.acceptedStatus = opts.acceptedStatus ?? 1;
    this.retries = opts.retries ?? 8;
  }

  // ---------------------------------------------------------------- reads
  private async view<T>(fn: string, args: unknown[] = []): Promise<T> {
    const raw = await this.client.readContract({
      address: this.address,
      functionName: fn,
      args,
    });
    if (raw === "" || raw == null) return null as T;
    return JSON.parse(String(raw)) as T;
  }

  async getConfig(): Promise<RegistryConfig> {
    return this.view<RegistryConfig>("get_config");
  }

  async getItem(itemId: string): Promise<ModerationItem | null> {
    return this.view<ModerationItem>("get_item", [itemId]);
  }

  async getAllItems(offset = 0, limit = 20, statusFilter = ""): Promise<ItemsPage> {
    return this.view<ItemsPage>("get_all_items", [offset, limit, statusFilter]);
  }

  async getItemsByAuthor(author: string): Promise<ItemsPage> {
    return this.view<ItemsPage>("get_items_by_author", [author]);
  }

  async getItemsByReporter(reporter: string): Promise<ItemsPage> {
    return this.view<ItemsPage>("get_items_by_reporter", [reporter]);
  }

  async getItemsByStatus(status: string): Promise<ItemsPage> {
    return this.view<ItemsPage>("get_items_by_status", [status]);
  }

  async getReputation(address: string): Promise<Reputation | null> {
    return this.view<Reputation>("get_reputation", [address]);
  }

  async getRules(version: number): Promise<RuleSetView | null> {
    return this.view<RuleSetView>("get_rules", [version]);
  }

  async getStats(): Promise<RegistryStats> {
    return this.view<RegistryStats>("get_stats");
  }

  async getPayouts(offset = 0, limit = 50): Promise<ItemsPage | null> {
    return this.view<unknown>("get_payouts", [offset, limit]) as Promise<ItemsPage | null>;
  }

  async getItemIdByUrl(url: string): Promise<string> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "get_item_by_url",
      args: [url],
    })) as string;
  }

  async readContent(itemId: string): Promise<string> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "read_content",
      args: [itemId],
    })) as string;
  }

  async verifyContent(itemId: string): Promise<boolean> {
    return (await this.client.readContract({
      address: this.address,
      functionName: "verify_content",
      args: [itemId],
    })) as boolean;
  }

  // --------------------------------------------------------------- writes
  /** Submit a write and wait for execution finality (FINISHED / FINISHED_WITH_RETURN). */
  async write(
    fn: string,
    args: unknown[] = [],
    value: bigint = 0n,
  ): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const hash = await this.client.writeContract({
          address: this.address,
          functionName: fn,
          args,
          value,
        });
        await this.client.waitForTransactionReceipt({
          hash,
          status: this.acceptedStatus,
          retries: 400,
        });
        await this.waitForFinalized(hash);
        return hash;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        // retry only transient errors; note writeContract may fail before or
        // after broadcast — consensus/state guards make retried writes safe
        // because a duplicate would revert without side effects
        if (isRetriable(msg) && attempt < this.retries) {
          await sleep(10_000);
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async waitForFinalized(hash: string, maxIters = 90): Promise<string> {
    for (let i = 0; i < maxIters; i++) {
      let tx;
      try {
        tx = await this.client.getTransaction({ hash });
      } catch {
        await sleep(5000);
        continue;
      }
      const rn = String(tx?.txExecutionResultName ?? "");
      if (rn === "FINISHED" || rn === "FINISHED_WITH_RETURN") return rn;
      if (/ERROR|REVERT|ROLL|DISAGREE|UNDETERMIN/i.test(rn)) {
        throw new Error(`transaction ${hash} failed: ${rn}`);
      }
      await sleep(6000);
    }
    throw new Error(`timeout waiting for finality of ${hash}`);
  }

  createItem(rulesText = ""): Promise<string> {
    return this.write("create_item", [rulesText]);
  }

  ingest(itemId: string, url: string, stake: bigint): Promise<string> {
    return this.write("ingest", [itemId, url], stake);
  }

  report(itemId: string, bond: bigint): Promise<string> {
    return this.write("report", [itemId], bond);
  }

  moderate(itemId: string): Promise<string> {
    return this.write("moderate", [itemId]);
  }

  /** Batch moderation: write returns a hash, so per-item verdicts are read back. */
  async moderateBatch(itemIds: string[]): Promise<BatchResult[]> {
    const hash = await this.write("moderate_batch", [itemIds]);
    void hash;
    const out: BatchResult[] = [];
    for (const item_id of itemIds) {
      const item = await this.getItem(item_id);
      out.push({
        item_id,
        ok: !!item && item.status === "moderated",
        verdict: item?.verdict ?? "",
        error: item ? "" : "Unknown item_id",
      });
    }
    return out;
  }

  enforce(itemId: string): Promise<string> {
    return this.write("enforce", [itemId]);
  }

  appeal(itemId: string, note: string, bond: bigint): Promise<string> {
    return this.write("appeal", [itemId, note], bond);
  }

  resolveAppeal(itemId: string): Promise<string> {
    return this.write("resolve_appeal", [itemId]);
  }

  reclaimAppeal(itemId: string): Promise<string> {
    return this.write("reclaim_appeal", [itemId]);
  }

  setRules(rulesText: string): Promise<string> {
    return this.write("set_rules", [rulesText]);
  }

  setThresholds(axis: string, flagBps: number, removeBps: number): Promise<string> {
    return this.write("set_thresholds", [axis, flagBps, removeBps]);
  }

  // ------------------------------------------------------ subscriptions
  /**
   * Poll-based subscription: fires on any change of any item (new items,
   * status/verdict changes, history growth). Returns an unsubscribe fn.
   */
  subscribe(
    onUpdate: (items: ItemsPage) => void,
    { intervalMs = 7000, limit = 50 }: { intervalMs?: number; limit?: number } = {},
  ): () => void {
    let stopped = false;
    let lastSnapshot = "";
    const tick = async () => {
      while (!stopped) {
        try {
          const page = await this.getAllItems(0, limit);
          const snap = JSON.stringify(
            page.items.map(
              (i) => [i.id, i.status, i.verdict, i.history.length, i.appeal_outcome],
            ),
          );
          if (snap !== lastSnapshot) {
            lastSnapshot = snap;
            onUpdate(page);
          }
        } catch {
          // polling must survive transient RPC failures
        }
        await sleep(intervalMs);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }
}
