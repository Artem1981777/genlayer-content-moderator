import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API stays a server app (Vercel / node). No static export here.
  output: "standalone",
};

export default nextConfig;
