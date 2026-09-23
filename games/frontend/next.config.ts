import type { NextConfig } from "next";
import os from "os";
import path from "path";

function localDevOrigins() {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" || addr.family === 4) hosts.add(addr.address);
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins(),
  devIndicators: false,
  turbopack: {
    root: path.join(__dirname)
  },
  transpilePackages: ["three"]
};

export default nextConfig;
