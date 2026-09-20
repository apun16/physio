import type { SensorCommand } from "../racing/sensor";
import type { RecoveryMethod } from "./types";

export type RecoveryActions = {
  pause: () => void;
  reconnect: () => void;
  sendCommand: (command: SensorCommand) => void | Promise<void>;
  fallbackHandCam: () => void;
  exit: () => void;
};

/** Invokes only existing racing-game actions. Never opens the port picker by itself. */
export function runRecovery(method: RecoveryMethod, actions: RecoveryActions) {
  try {
    if (method === "wait_for_frames") {
      actions.pause();
      return;
    }
    if (method === "reconnect") {
      actions.pause();
      actions.reconnect();
      return;
    }
    if (method === "calibrate") {
      actions.pause();
      void actions.sendCommand("center");
      return;
    }
    if (method === "hand_cam_fallback") {
      actions.pause();
      actions.fallbackHandCam();
      return;
    }
    actions.pause();
    actions.exit();
  } catch {
    // Recovery UI / Sentry failures must never take down the game.
  }
}
