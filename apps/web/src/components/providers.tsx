"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { WalletProvider } from "@/components/wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <WalletProvider>
        {children}
        <Toaster position="bottom-right" richColors />
      </WalletProvider>
    </ThemeProvider>
  );
}
