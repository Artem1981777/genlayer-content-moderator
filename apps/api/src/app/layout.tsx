import type { Metadata } from "next";

export const metadata: Metadata = { title: "ContentModerator API" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-monospace, monospace", margin: 0, padding: 24, background: "#0a0a0a", color: "#fafafa" }}>
        {children}
      </body>
    </html>
  );
}
