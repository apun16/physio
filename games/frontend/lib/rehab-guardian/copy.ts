import type { ConfirmationChoice, DiagnosisChoice, FailureType, GuardianPhase, RecoveryMethod } from "./types";

export const BEETY_INTRO = "hi i'm beety the bug here to help!";

export type SidekickCopy = {
  title: string;
  body: string;
  question: string;
};

const FAILURE: Record<FailureType, SidekickCopy> = {
  web_serial_unsupported: {
    title: "This browser can't talk to the sensor",
    body: "This game needs Chrome or Edge for the IMU. Your progress is saved.",
    question: "Please open the game in Chrome or Edge, then come back."
  },
  port_open_failed: {
    title: "Couldn't open the sensor",
    body: "The browser couldn't open the ESP32 serial port you selected. Your session is paused.",
    question: "Want to try connecting again?"
  },
  unexpected_disconnect: {
    title: "Sensor disconnected",
    body: "The ESP32 stopped during your session. Your progress is paused, not lost.",
    question: "Did you disconnect the sensor intentionally?"
  },
  read_loop_failure: {
    title: "Sensor reading stopped",
    body: "The live serial reader stopped unexpectedly. Your session is paused.",
    question: "Did you disconnect the sensor intentionally?"
  },
  stale_stream: {
    title: "Sensor updates paused",
    body: "The connection still looks open, but no valid IMU frame arrived in time. Your session is paused so the character doesn't drift.",
    question: "What did you notice?"
  },
  persistent_malformed: {
    title: "Sensor packets look mixed up",
    body: "Several packets in a row were not the expected five-field format. Your session is paused.",
    question: "What did you notice?"
  },
  invalid_values: {
    title: "Sensor values look invalid",
    body: "Packets arrived with missing numbers, NaN, or infinity. Your session is paused. No raw readings were stored.",
    question: "What did you notice?"
  },
  frozen_readings: {
    title: "Readings look frozen",
    body: "The sensor kept sending the same values for a while. That can be you holding still — I won't treat that as a hardware failure unless you say otherwise.",
    question: "Were you intentionally holding still?"
  },
  unrealistic_jump: {
    title: "Sensor jumped unexpectedly",
    body: "A sudden change looked too large to be real motion. Your session is paused. Only the category was recorded, not the raw reading.",
    question: "What did you notice?"
  },
  command_write_failed: {
    title: "Calibration didn't send",
    body: "The browser failed to send a calibration or center command.",
    question: "Want to try again, or reconnect?"
  },
  command_ack_timeout: {
    title: "No calibration reply",
    body: "The command was sent, but the ESP32 never acknowledged it.",
    question: "Want to try again, or reconnect?"
  },
  fallback_failed: {
    title: "Hand camera didn't start",
    body: "The existing hand-camera fallback couldn't start. You can reconnect the sensor or exit.",
    question: "Want to reconnect the sensor instead?"
  },
  sidekick_failure: {
    title: "Helper had a hiccup",
    body: "The helper UI hit a snag. The game is still running.",
    question: ""
  },
  recovery_unresolved: {
    title: "Still working on it",
    body: "Reconnection or calibration didn't restore a stable signal yet.",
    question: "Want to reconnect, wait, or use hand camera?"
  }
};

export const DIAGNOSIS_LABELS: Record<DiagnosisChoice, string> = {
  controls_stopped: "Controls stopped responding",
  wrong_direction: "Movement went the wrong direction",
  intentionally_still: "I was intentionally holding still",
  not_sure: "I'm not sure"
};

export const CONFIRM_LABELS: Record<ConfirmationChoice, string> = {
  works_now: "It works now",
  still_wrong: "It is still wrong"
};

export function greetingCopy(): SidekickCopy {
  return {
    title: BEETY_INTRO,
    body: "",
    question: ""
  };
}

export function connectingCopy(): SidekickCopy {
  return {
    title: "Connecting sensor",
    body: "Waiting for a stable IMU signal.",
    question: "Hang tight while I wait for the first good frame."
  };
}

export function recoveredCopy(): SidekickCopy {
  return {
    title: "Signal looks stable",
    body: "Valid sensor updates are back.",
    question: "Does the controller feel right?"
  };
}

export function fallbackCopy(): SidekickCopy {
  return {
    title: "Hand camera is ready",
    body: "This game already supports hand-camera steering.",
    question: "Does that feel right?"
  };
}

export function unresolvedCopy(): SidekickCopy {
  return {
    title: "Still here if you need me",
    body: "The sensor isn't stable yet. Reconnect, wait, or use hand camera.",
    question: "Want to reconnect, wait, or switch to hand camera?"
  };
}

export function recoveringCopy(): SidekickCopy {
  return {
    title: "Checking the sensor",
    body: "Waiting for stable updates. Your progress is paused, not lost.",
    question: "I'll let you know when a stable signal comes back."
  };
}

export function copyFor(phase: GuardianPhase, failureType: FailureType | null): SidekickCopy {
  if (phase === "connecting") return connectingCopy();
  if (phase === "recovering") return recoveringCopy();
  if (phase === "recovered") return recoveredCopy();
  if (phase === "fallback_active") return fallbackCopy();
  if (phase === "unresolved") return unresolvedCopy();
  if (failureType) return FAILURE[failureType];
  return greetingCopy();
}

export function recoveryLabels(): Record<RecoveryMethod, string> {
  return {
    wait_for_frames: "Wait for signal",
    reconnect: "Reconnect sensor",
    calibrate: "Calibrate (I'll confirm)",
    hand_cam_fallback: "Use hand camera",
    pause_and_exit: "Exit to quest hub"
  };
}
