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

  it("appears after a surprise disconnect", async () => {
    let state = reduce(reduce(createGuardian(), { type: "connecting" }), { type: "first_valid_frame" });
    state = reduce(state, { type: "unexpected_disconnect" });
    state = reduce(state, { type: "prompt_user" });
    renderSidekick(state, false);
    expect(await screen.findByRole("dialog", { name: /beety the bug/i })).toBeTruthy();
    expect(screen.getByText(/did you disconnect the sensor intentionally/i)).toBeTruthy();
  });
});
