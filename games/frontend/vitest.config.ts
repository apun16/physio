import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "lib/rehab-guardian/**/*.test.ts",
      "lib/racing/**/*.test.ts",
      "components/sentry-sidekick/**/*.test.ts",
      "components/sentry-sidekick/**/*.test.tsx"
    ]
  }
});
