import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: ReturnType<typeof vi.fn>; setFingerprint: ReturnType<typeof vi.fn>; setContext: ReturnType<typeof vi.fn> }) => void) => {
    fn({ setTag: vi.fn(), setFingerprint: vi.fn(), setContext: vi.fn() });
  }),
  startInactiveSpan: vi.fn(() => ({ end: vi.fn() })),
  setMeasurement: vi.fn()
}));

vi.mock("@sentry/nextjs", () => sentry);

import { createGuardian } from "./machine";
import { assertSanitized, sanitizeIncident } from "./privacy";
import { reportFailure, reportRecovery, resetReporterForTests } from "./reporter";

const incident = {
  ...createGuardian(),
  phase: "failure_detected" as const,
  failureType: "stale_stream" as const,
  incidentId: "rg_test_1",
  msSinceLastValid: 900,
  malformedCount: 0,
  source: "real" as const,
  inputMode: "imu" as const
};

describe("sentry reporter", () => {
  beforeEach(() => {
    resetReporterForTests();
    sentry.captureException.mockClear();
    sentry.captureMessage.mockClear();
  });

  it("sends sanitized metadata only", () => {
    const payload = sanitizeIncident(incident, "test");
    expect(payload).toBeTruthy();
    assertSanitized(payload!);
    const blob = JSON.stringify(payload);
    expect(blob).not.toMatch(/\d+\.\d+,\d+\.\d+/);
    expect(blob).not.toContain("raw");
    expect(payload!.firmwarePacket).toBe("five-field");
    expect(payload!.game).toBe("racing");
    reportFailure(incident);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const error = sentry.captureException.mock.calls[0][0] as Error;
    expect(error.message).toBe("Rehab Guardian: stale_stream");
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toMatch(/\d+\.\d+,\d+\.\d+/);
  });

  it("dedupes and rate-limits the same failure type", () => {
    reportFailure(incident);
    reportFailure(incident);
    reportFailure({ ...incident, incidentId: "rg_test_2" });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("reports recovery without raw packets", () => {
    reportFailure(incident);
    const recovered = { ...incident, phase: "recovered" as const, recoveryMethod: "reconnect" as const, recoveryResult: "success" as const };
    const payload = reportRecovery(recovered);
    expect(payload).toBeTruthy();
    assertSanitized(payload!);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(String(sentry.captureMessage.mock.calls[0][0])).not.toMatch(/\d+\.\d+,\d+\.\d+/);
  });

  it("does not drop an incident id that happens to contain a forbidden substring", () => {
    const payload = sanitizeIncident({ ...incident, incidentId: "rg_move_name_1" }, "development");
    expect(payload).toBeTruthy();
    expect(() => assertSanitized(payload!)).not.toThrow();
  });

  it("tags Zelda incidents as skyward", () => {
    const payload = sanitizeIncident(incident, "test", "skyward");
    expect(payload!.game).toBe("skyward");
    assertSanitized(payload!);
    reportFailure(incident, "skyward");
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
