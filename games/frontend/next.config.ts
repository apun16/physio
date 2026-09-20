import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: path.join(__dirname)
  },
  transpilePackages: ["three"]
};

export default nextConfig;
