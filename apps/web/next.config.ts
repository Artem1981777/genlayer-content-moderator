import type { NextConfig } from "next";

// Static export: the dApp ships to GitHub Pages next to the legacy dApp.
// Live reads go straight from the browser to the Bradbury RPC.
const repo = process.env.NEXT_PUBLIC_BASE_PATH ?? "/genlayer-content-moderator";

const nextConfig: NextConfig = {
  output: "export",
  basePath: repo,
  assetPrefix: repo,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
