import * as SentryNS from "@sentry/nextjs";

const Sentry = (SentryNS as { default?: typeof SentryNS }).default ?? SentryNS;
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && typeof Sentry.init === "function") {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.1,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    }
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart ?? (() => undefined);
