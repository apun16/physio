import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname)
  },
  transpilePackages: ["three"]
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN
  }
});
