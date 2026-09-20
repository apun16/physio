import * as Sentry from "@sentry/nextjs";

export async function register() {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  } catch {
    // Missing DSN or SDK failure must never block the app.
  }
}

export const onRequestError = Sentry.captureRequestError;
