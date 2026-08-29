import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Instagram thumbnails come from CDN hosts we don't control; we render them
  // with plain <img> rather than next/image to avoid whitelisting churn.
  reactStrictMode: true,
};

export default nextConfig;
