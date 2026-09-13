"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createPublicClient, custom, type PublicClient } from "viem";
import { BRADBURY } from "@genlayer-cm/sdk";

/**
 * EIP-1193 wallet context (MetaMask & friends): connect, network guard
 * (add/switch Bradbury 4221), current address. Writes go through the
 * injected provider; reads use the public RPC via the SDK client.
 */

const bradburyViem = {
  id: BRADBURY.chainId,
  name: "GenLayer Bradbury",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [BRADBURY.rpc] } },
  blockExplorers: { default: { name: "Explorer", url: BRADBURY.explorer } },
} as const;

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
};

interface WalletCtx {
  address: string | null;
  connect: () => Promise<void>;
  provider: EthereumProvider | null;
  publicClient: PublicClient | null;
  onBradbury: boolean;
}

const Ctx = createContext<WalletCtx>({
  address: null,
  connect: async () => {},
  provider: null,
  publicClient: null,
  onBradbury: false,
});

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    setProvider(eth);
    const onAccounts = (accs: string[]) =>
      setAddress(accs && accs.length > 0 ? accs[0] : null);
    const onChain = (id: string) => setChainId(parseInt(id, 16));
    eth.on?.("accountsChanged", onAccounts as never);
    eth.on?.("chainChanged", onChain as never);
    void eth
      .request({ method: "eth_accounts" })
      .then((a) => onAccounts(a as string[]))
      .catch(() => {});
    void eth
      .request({ method: "eth_chainId" })
      .then((c) => setChainId(parseInt(String(c), 16)))
      .catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      toast.error("No EIP-1193 wallet found. Install MetaMask.");
      return;
    }
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accs[0] ?? null);
      let cid = parseInt(String(await eth.request({ method: "eth_chainId" })), 16);
      if (cid !== BRADBURY.chainId) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x107d" }], // 4221
          });
          cid = BRADBURY.chainId;
        } catch {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x107d",
                chainName: "GenLayer Testnet Bradbury",
                nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                rpcUrls: [BRADBURY.rpc],
                blockExplorerUrls: [BRADBURY.explorer],
              },
            ],
          });
          cid = BRADBURY.chainId;
        }
      }
      setChainId(cid);
      toast.success("Wallet connected");
    } catch (e) {
      toast.error("Wallet connection rejected");
      console.error(e);
    }
  }, []);

  const publicClient = useMemo(
    () => (provider ? createPublicClient({ transport: custom(provider as never) }) : null),
    [provider],
  );

  const value = useMemo(
    () => ({
      address,
      connect,
      provider,
      publicClient,
      onBradbury: chainId === BRADBURY.chainId,
    }),
    [address, connect, provider, publicClient, chainId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWallet = () => useContext(Ctx);
export { bradburyViem };
