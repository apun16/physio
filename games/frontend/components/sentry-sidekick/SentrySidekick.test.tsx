/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createGuardian, reduce } from "../../lib/rehab-guardian/machine";
import SentrySidekick from "./SentrySidekick";

const noop = () => undefined;

function renderSidekick(state = createGuardian(), running = false) {
  return render(
    <SentrySidekick
      state={state}
      gameRunning={running}
      payload={null}
      onDiagnosis={noop}
      onRecovery={noop}
      onConfirm={noop}
      onIntent={noop}
      onCalibrateAsk={noop}
      calibratePending={false}
      onCalibrateConfirm={noop}
    />
  );
}

describe("Sentry Sidekick", () => {
  afterEach(() => cleanup());

  it("stays hidden while the IMU is connected and healthy", async () => {
    const healthy = reduce(reduce(createGuardian(), { type: "connecting" }), { type: "first_valid_frame" });
    renderSidekick(healthy, true);
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /beety the bug/i })).toBeNull();
      expect(screen.queryByRole("dialog", { name: /beety the bug/i })).toBeNull();
    });
  });

  it("appears after a real Guardian failure event", async () => {
    let state = reduce(reduce(createGuardian(), { type: "connecting" }), { type: "first_valid_frame" });
    state = reduce(state, { type: "stream_stale", msSinceLastValid: 900 });
    state = reduce(state, { type: "prompt_user" });
    renderSidekick(state, false);
    expect(await screen.findByRole("dialog", { name: /beety the bug/i })).toBeTruthy();
    expect(screen.getByText(/hi i'm beety the bug here to help!/i)).toBeTruthy();
    expect(screen.getByText(/no valid IMU frame arrived/i)).toBeTruthy();
  });
});
