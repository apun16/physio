import { describe, expect, it } from "vitest";
import { createGuardian, isSidekickVisible, reduce } from "./machine";
import { MALFORMED_THRESHOLD, type GuardianState } from "./types";

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
  });

  it("does not treat a live X/Y sweep as an incident", () => {
    expect(reduce(healthy(), { type: "unrealistic_jump" }).phase).toBe("healthy");
  });

  it("treats frozen readings as an incident after the long stillness window", () => {
    const state = reduce(healthy(), { type: "frozen_readings" });
    expect(state.phase).toBe("failure_detected");
    expect(state.failureType).toBe("frozen_readings");
  });

  it("creates a stale-stream incident from a previously live session", () => {
    const detected = reduce(healthy(), { type: "stream_stale", msSinceLastValid: 900 });
    expect(detected.phase).toBe("failure_detected");
    expect(detected.failureType).toBe("stale_stream");
    expect(detected.incidentId).toBeTruthy();
    const waiting = reduce(detected, { type: "prompt_user" });
    expect(waiting.phase).toBe("awaiting_user");
  });

  it("does not fail on a single malformed packet", () => {
    const state = reduce(healthy(), { type: "malformed_frame", at: 1 });
    expect(state.phase).toBe("degraded");
    expect(state.failureType).toBeNull();
  });

  it("opens an incident after persistent malformed packets", () => {
    let state = healthy();
    for (let i = 0; i < MALFORMED_THRESHOLD; i += 1) state = reduce(state, { type: "malformed_frame", at: 10 + i });
    expect(state.phase).toBe("failure_detected");
    expect(state.failureType).toBe("persistent_malformed");
    expect(state.malformedCount).toBe(MALFORMED_THRESHOLD);
  });

  it("suppresses an intentional disconnect", () => {
    const state = reduce(healthy(), { type: "intentionally_disconnected" });
    expect(state.phase).toBe("pre_game");
    expect(state.failureType).toBeNull();
    expect(state.recoveryResult).toBe("suppressed");
  });

  it("suppresses a cancelled port picker", () => {
    const cancelled = reduce(play(), { type: "port_picker_cancelled" });
    expect(cancelled.phase).toBe("pre_game");
    expect(cancelled.incidentId).toBeNull();
    const fromConnecting = reduce(reduce(play(), { type: "connecting" }), { type: "port_picker_cancelled" });
    expect(fromConnecting.phase).toBe("pre_game");
    expect(fromConnecting.failureType).toBeNull();
  });

  it("records successful recovery", () => {
    let state = reduce(healthy(), { type: "stream_stale", msSinceLastValid: 800 });
    state = reduce(state, { type: "prompt_user" });
    state = reduce(state, { type: "user_diagnosis", choice: "controls_stopped" });
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

  it("does not treat intentional stillness as a hardware failure", () => {
    let state = reduce(healthy(), { type: "stream_stale", msSinceLastValid: 800 });
    state = reduce(state, { type: "prompt_user" });
    state = reduce(state, { type: "user_diagnosis", choice: "intentionally_still" });
    expect(state.phase).toBe("healthy");
    expect(state.recoveryResult).toBe("suppressed");
    expect(state.failureType).toBeNull();
  });

  it("hides the sidekick during healthy gameplay and shows it after a failure", () => {
    const live = healthy();
    expect(isSidekickVisible(live, true)).toBe(false);
    const failed = reduce(live, { type: "stream_stale", msSinceLastValid: 900 });
    expect(isSidekickVisible(failed, false)).toBe(true);
    expect(isSidekickVisible(reduce(failed, { type: "prompt_user" }), true)).toBe(true);
  });
});
