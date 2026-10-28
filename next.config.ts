import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Native/WASM and Node-only packages stay outside the server bundle.
  serverExternalPackages: ["@electric-sql/pglite", "pptxgenjs", "postgres"],
};

export default nextConfig;
