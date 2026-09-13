// Single source of chain/address configuration for all v2 scripts.
// Contract addresses come from deployments.json (written by deploy.mjs);
// no script hardcodes them.
import { readFileSync, existsSync } from "node:fs";

export const CHAIN_ID = 4221;
export const CHAIN_ID_HEX = "0x107d";
export const RPC = "https://rpc-bradbury.genlayer.com";
export const EXPLORER = "https://explorer-bradbury.genlayer.com";
export const PAGES = "https://artem1981777.github.io/genlayer-content-moderator";
// consensus main contract of the Bradbury train consensus (from the
// genlayer-js / genlayer CLI chain definitions)
export const CONSENSUS_MAIN = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D";

export function deployments() {
  if (!existsSync("deployments.json")) return null;
  return JSON.parse(readFileSync("deployments.json", "utf8"));
}

export function prodAddress() {
  const d = deployments();
  if (!d?.prod?.address) throw new Error("deployments.json missing prod address — run scripts/deploy.mjs");
  return d.prod.address;
}

export function demoAddress() {
  const d = deployments();
  if (!d?.demo?.address) throw new Error("deployments.json missing demo address — run scripts/deploy.mjs");
  return d.demo.address;
}

export function txLink(hash) {
  return EXPLORER + "/tx/" + String(hash);
}
