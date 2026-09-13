export * from "./types.js";
export { RegistryClient } from "./client.js";
export type { RegistryClientOptions, GenLayerClientLike } from "./client.js";

import { RegistryClient } from "./client.js";
import type { RegistryClientOptions } from "./client.js";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

export const BRADBURY = {
  chainId: 4221,
  rpc: "https://rpc-bradbury.genlayer.com",
  explorer: "https://explorer-bradbury.genlayer.com",
} as const;

export interface CreateRegistryClientArgs
  extends Omit<RegistryClientOptions, "client" | "acceptedStatus"> {
  /** Optional private key; when omitted the client is read-only. */
  privateKey?: string;
}

/**
 * Convenience factory binding genlayer-js to GenLayer Testnet Bradbury.
 * For other chains/tests, construct RegistryClient directly with your own
 * genlayer-js client instance.
 */
export function createRegistryClient(args: CreateRegistryClientArgs): RegistryClient {
  const { privateKey, ...rest } = args;
  const account = privateKey
    ? createAccount(privateKey as `0x${string}`)
    : undefined;
  const glClient = createClient({
    chain: testnetBradbury,
    account,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any); // address is validated by the contract layer; genlayer-js narrows to 0x-string
  return new RegistryClient({
    ...rest,
    client: glClient as unknown as RegistryClientOptions["client"],
  });
}

export function txExplorerLink(hash: string): string {
  return `${BRADBURY.explorer}/tx/${hash}`;
}

export function addressExplorerLink(address: string): string {
  return `${BRADBURY.explorer}/address/${address}`;
}
