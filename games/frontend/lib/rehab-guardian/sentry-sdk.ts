import * as SentryNS from "@sentry/nextjs";

export type GuardianScope = {
  setTag: (key: string, value: string) => void;
  setFingerprint: (values: string[]) => void;
  setContext: (name: string, ctx: Record<string, unknown>) => void;
};

export type SentrySdk = {
  init?: (options: { dsn: string; sendDefaultPii?: boolean; tracesSampleRate?: number }) => void;
  captureException?: (error: Error) => unknown;
  captureMessage?: (message: string, level?: "info" | "warning" | "error") => unknown;
  withScope?: (callback: (scope: GuardianScope) => void) => void;
  addBreadcrumb?: (breadcrumb: {
    category?: string;
    message: string;
    level?: string;
    data?: Record<string, unknown>;
  }) => void;
  setMeasurement?: (name: string, value: number, unit: string) => void;
  startInactiveSpan?: (options: { name: string; op?: string }) => { end: () => void } | undefined;
  getClient?: () => unknown;
};

function unwrap(): SentrySdk {
  const mod = SentryNS as SentrySdk & { default?: SentrySdk };
  if (typeof mod.captureException === "function") return mod;
  if (mod.default && typeof mod.default.captureException === "function") return mod.default;
  return mod.default ?? mod;
}

/** Browser/server Sentry handle. Re-inits if instrumentation-client never loaded. */
export function sentrySdk(): SentrySdk {
  const sdk = unwrap();
  if (!sdk.getClient?.() && typeof sdk.init === "function") {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
    if (dsn) sdk.init({ dsn, sendDefaultPii: false, tracesSampleRate: 1 });
  }
  return sdk;
}
