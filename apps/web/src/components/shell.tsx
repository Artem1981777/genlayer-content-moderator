"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, Wallet } from "lucide-react";
import { useWallet } from "@/components/wallet";
import { short } from "@/components/registry-ui";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/app/", label: "Registry" },
  { href: "/app/submit/", label: "Submit" },
  { href: "/app/rules/", label: "Rules" },
  { href: "/docs/", label: "Docs" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { address, connect, onBradbury } = useWallet();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          ContentModerator
          <span className="mono rounded bg-neutral-200 px-1 text-[10px] dark:bg-neutral-800">v2</span>
        </Link>
        <nav className="flex flex-1 flex-wrap gap-4 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                path === n.href || (n.href !== "/" && path.startsWith(n.href))
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200"
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={connect}
          className={`mono flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
            onBradbury
              ? "border-neutral-300 dark:border-neutral-700"
              : "border-amber-600/50 text-amber-600 dark:text-amber-400"
          }`}
        >
          <Wallet className="h-3.5 w-3.5" />
          {address ? short(address, 4) : "Connect wallet"}
          {address && !onBradbury && <span className="text-amber-500">wrong network</span>}
        </button>
      </header>
      {children}
      <footer className="mono mt-16 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        GenLayer Testnet Bradbury (chain 4221) · contract v2 · consensus-moderated, owner cannot overturn verdicts
      </footer>
    </div>
  );
}
