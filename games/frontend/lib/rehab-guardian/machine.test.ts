import { describe, expect, it } from "vitest";
import { createGuardian, isSidekickVisible, reduce } from "./machine";
import { MALFORMED_THRESHOLD } from "./types";

function play(seed: Partial<GuardianState> = {}) {
  return reduce(createGuardian(seed), { type: "session_start" });
}

function healthy() {
  return reduce(reduce(play(), { type: "connecting" }), { type: "first_valid_frame" });
}

describe("guardian state machine", () => {
  it("connects then becomes healthy on the first valid frame", () => {
    const state = healthy();
    expect(state.phase).toBe("healthy");
    expect(state.failureType).toBeNull();
    expect(state.greetingActive).toBe(false);
    expect(isSidekickVisible(state, true)).toBe(false);
  });

  it("does not overlay during live MPU6050 play", () => {
    const live = healthy();
    const noisy = [
      { type: "unrealistic_jump" as const },
      { type: "frozen_readings" as const },
      { type: "stream_stale" as const, msSinceLastValid: 60_000 },
      { type: "command_ack_timeout" as const },
      { type: "command_write_failed" as const },
      { type: "malformed_frame" as const, at: 1 },
      { type: "invalid_values" as const, at: 1 }
    ];
    let state = live;
    for (const event of noisy) state = reduce(state, event);
    for (let i = 0; i < MALFORMED_THRESHOLD; i += 1) state = reduce(state, { type: "malformed_frame", at: 10 + i });
    expect(state.phase).toBe("healthy");
    expect(state.failureType).toBeNull();
    expect(isSidekickVisible(state, true)).toBe(false);
  });

  it("suppresses an intentional disconnect", () => {
    const state = reduce(healthy(), { type: "intentionally_disconnected" });
    expect(state.phase).toBe("pre_game");
    expect(state.failureType).toBeNull();
    expect(state.recoveryResult).toBe("suppressed");
    expect(isSidekickVisible(state, true)).toBe(false);
  });

  it("suppresses a cancelled port picker", () => {
    const cancelled = reduce(play(), { type: "port_picker_cancelled" });
    expect(cancelled.phase).toBe("pre_game");
    expect(cancelled.incidentId).toBeNull();
    const fromConnecting = reduce(reduce(play(), { type: "connecting" }), { type: "port_picker_cancelled" });
    expect(fromConnecting.phase).toBe("pre_game");
    expect(fromConnecting.failureType).toBeNull();
  });

  it("records successful recovery after a real disconnect", () => {
    let state = reduce(healthy(), { type: "unexpected_disconnect" });
    state = reduce(state, { type: "prompt_user" });
    state = reduce(state, { type: "user_intent", intentional: false });
    state = reduce(state, { type: "start_recovery", method: "reconnect" });
    expect(state.phase).toBe("recovering");
    state = reduce(state, { type: "first_valid_frame" });
    expect(state.phase).toBe("recovered");
    expect(state.recoveryResult).toBe("success");
    state = reduce(state, { type: "user_confirms", choice: "works_now" });
    expect(state.phase).toBe("healthy");
  });

  it("records unresolved recovery", () => {
    let state = reduce(healthy(), { type: "unexpected_disconnect" });
    state = reduce(state, { type: "prompt_user" });
    state = reduce(state, { type: "user_intent", intentional: false });
    state = reduce(state, { type: "start_recovery", method: "wait_for_frames" });
    state = reduce(state, { type: "recovery_unresolved" });
    expect(state.phase).toBe("unresolved");
    expect(state.recoveryResult).toBe("unresolved");
  });

  it("asks about surprise disconnect and suppresses a Yes", () => {
    let state = reduce(healthy(), { type: "unexpected_disconnect" });
    state = reduce(state, { type: "prompt_user" });
    expect(state.promptKind).toBe("intentional_disconnect");
    expect(state.sentryDeferred).toBe(true);
    state = reduce(state, { type: "user_intent", intentional: true });
    expect(state.phase).toBe("pre_game");
    expect(state.failureType).toBeNull();
    expect(state.recoveryResult).toBe("suppressed");
  });

  it("reports a surprise disconnect when the player says No", () => {
    let state = reduce(healthy(), { type: "unexpected_disconnect" });
    state = reduce(state, { type: "prompt_user" });
    state = reduce(state, { type: "user_intent", intentional: false });
    expect(state.promptKind).toBe("recovery");
    expect(state.sentryDeferred).toBe(false);
    expect(state.failureType).toBe("unexpected_disconnect");
  });

  it("hides the sidekick during healthy gameplay and shows it after a disconnect", () => {
    const live = healthy();
    expect(isSidekickVisible(live, true)).toBe(false);
    const failed = reduce(live, { type: "unexpected_disconnect" });
    expect(isSidekickVisible(failed, false)).toBe(true);
    expect(isSidekickVisible(reduce(failed, { type: "prompt_user" }), true)).toBe(true);
  });
});
