/** Domain types of the ContentModerator registry v2 contract. */

export const AXES = [
  "scam",
  "spam",
  "harassment",
  "hate",
  "violence",
  "sexual",
  "self_harm",
] as const;
export type Axis = (typeof AXES)[number];

export type Verdict = "APPROVE" | "FLAG" | "REMOVE";
export type Status =
  | "created"
  | "ingested"
  | "moderated"
  | "enforced"
  | "appealed"
  | "resolved";

export type AxisScores = Record<Axis, number> & { injection_attempt?: number };

export interface HistoryEntry {
  n: number;
  action: string;
  by: string;
  ts: number;
  note: string;
}

export interface ModerationItem {
  id: string;
  source: string;
  url_hash: string;
  creator: string;
  author: string;
  reporter: string;
  rules_version: number;
  status: Status;
  verdict: Verdict | "";
  reason: string;
  category: string;
  confidence: number;
  severity: "none" | "medium" | "high";
  scores: Record<Axis, number>;
  injection_attempt: number;
  injection_detected: boolean;
  needs_review: boolean;
  enforced: boolean;
  blocked: boolean;
  limited: boolean;
  enforcement_action: "removed" | "limited" | "none";
  appeal_note: string;
  appeal_outcome: "overturned" | "upheld" | "reclaimed_timeout" | "";
  author_stake: number;
  reporter_bond: number;
  appeal_stake: number;
  forfeited: number;
  stake_outcome: string;
  content: string;
  content_hash: string;
  created_ts: number;
  verdict_ts: number;
  appeal_ts: number;
  last_llm_ts: number;
  history: HistoryEntry[];
}

export interface RegistryConfig {
  owner: string;
  default_rules: string;
  min_stake: number;
  report_bond: number;
  appeal_bond: number;
  enforce_timeout_sec: number;
  appeal_resolve_cooldown_sec: number;
  appeal_timeout_sec: number;
  llm_cooldown_sec: number;
  max_open_reports: number;
  max_open_appeals: number;
  pool: number;
  item_count: number;
  rules_version: number;
  flag_bp: Record<Axis, number>;
  remove_bp: Record<Axis, number>;
}

export interface Payout {
  to: string;
  amount: number;
  reason: string;
}

export interface PayoutsPage {
  offset: number;
  limit: number;
  total: number;
  payouts: Payout[];
}

export interface ItemsPage {
  offset: number;
  limit: number;
  total: number;
  items: ModerationItem[];
}

export interface Reputation {
  address: string;
  approved: number;
  removed: number;
  honest_reports: number;
  false_reports: number;
  appeals_won: number;
  required_report_bond: number;
}

export interface RuleSetView {
  version: number;
  text: string;
  flag_bp: Record<Axis, number>;
  remove_bp: Record<Axis, number>;
  set_ts: number;
}

export interface RegistryStats {
  total: number;
  by_status: Record<string, number>;
  by_verdict: Record<string, number>;
  total_staked: number;
  payouts_sum: number;
  pool: number;
  injection_caught: number;
}

export interface BatchResult {
  item_id: string;
  ok: boolean;
  verdict: string;
  error: string;
}
