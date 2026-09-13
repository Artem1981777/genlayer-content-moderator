import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "ContentModerator — AI moderation on GenLayer",
  description:
    "Decentralized AI content moderation: validator-consensus verdicts, staking, permissionless appeals and on-chain reputation on GenLayer Bradbury.",
  openGraph: {
    title: "ContentModerator — AI moderation on GenLayer",
    description:
      "Validator-consensus verdicts, staking, permissionless appeals and on-chain reputation.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-100 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
