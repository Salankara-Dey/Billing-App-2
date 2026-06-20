import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.EXPORT_MODE === 'true' ? 'export' : undefined,
  images: {
    unoptimized: true,
  }
};

export default nextConfig;
