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

type SentryModule = SentrySdk & { default?: SentryModule };

function nestedDefault(mod: SentryModule): SentryModule | undefined {
  try {
    const inner = mod.default;
    if (!inner || inner === mod) return undefined;
    return inner;
  } catch {
    return undefined;
  }
}

function unwrap(): SentrySdk {
  const mod = SentryNS as SentryModule;
  const inner = nestedDefault(mod);
  const nested = inner ? nestedDefault(inner) : undefined;
  const candidates: SentrySdk[] = [mod, inner, nested].filter((sdk): sdk is SentrySdk => Boolean(sdk));
  return (
    candidates.find((sdk) => typeof sdk.captureException === "function") ??
    candidates.find((sdk) => typeof sdk.captureMessage === "function") ??
    inner ??
    mod
  );
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
