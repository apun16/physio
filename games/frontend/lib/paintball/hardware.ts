/**
 * Hardware controller mapping for Inkburst.
 *
 *   squeeze -> shoot
 *   steer   -> move left and right
 *   roll    -> move forward and back
 *
 * Aiming stays on the mouse: the controller supplies the rehab movement, the
 * cursor supplies the look, exactly as it does in the other worlds.
 */

import type { SerialSensor } from "../racing/sensor";

export const PAINTBALL_TUNING = {
  /** steer arrives normalised -1..1. Ignore anything inside this. */
  steerDeadzone: 0.12,
  /** Travel from the deadzone edge to this value is the full movement range. */
  steerFull: 0.75,
  /** roll arrives in degrees from neutral. Ignore anything inside this. */
  rollDeadzone: 8,
  /** Degrees of roll that count as a full forward or back push. */
  rollFull: 35,
  /** Squeeze above this pulls the trigger. */
  fireAt: 0.35,
  /** Squeeze has to fall back under this before the next shot. */
  fireRearm: 0.2,
  /** Flip if leaning right moves you left, or roll runs backwards. */
  steerSign: 1,
  rollSign: 1,
  /** Seconds between debug lines in the dev terminal. 0 disables. */
  logEvery: 0
};

/** Map a signed reading onto -1..1 with a deadzone and a saturation point. */
function axis(value: number, deadzone: number, full: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const span = Math.max(0.0001, full - deadzone);
  return Math.sign(value) * Math.min(1, (magnitude - deadzone) / span);
}

export type HardwareMove = {
  /** -1..1, positive is forward */
  forward: number;
  /** -1..1, positive is right */
  strafe: number;
  /** True on the frame the trigger is pulled */
  fired: boolean;
  live: boolean;
};

const IDLE: HardwareMove = { forward: 0, strafe: 0, fired: false, live: false };

export class PaintballHardware {
  private armed = true;
  private logT = 0;

  constructor(private sensor: SerialSensor) {}

  get live() {
    return this.sensor.isLive(performance.now());
  }

  poll(dt: number): HardwareMove {
    const now = performance.now();
    const frame = this.sensor.latest;
    if (!this.sensor.isLive(now) || !frame) {
      this.armed = true;
      return IDLE;
    }

    const strafe = axis(frame.steer * PAINTBALL_TUNING.steerSign, PAINTBALL_TUNING.steerDeadzone, PAINTBALL_TUNING.steerFull);
    const forward = axis(frame.roll * PAINTBALL_TUNING.rollSign, PAINTBALL_TUNING.rollDeadzone, PAINTBALL_TUNING.rollFull);

    // Squeeze is a trigger, not a level: one shot per squeeze, re-armed when
    // the grip relaxes. The game's own fire cooldown still applies on top.
    const squeeze = frame.squeeze ?? 0;
    let fired = false;
    if (this.armed && squeeze >= PAINTBALL_TUNING.fireAt) {
      fired = true;
      this.armed = false;
    } else if (!this.armed && squeeze <= PAINTBALL_TUNING.fireRearm) {
      this.armed = true;
    }

    if (PAINTBALL_TUNING.logEvery > 0) {
      this.logT += dt;
      if (this.logT >= PAINTBALL_TUNING.logEvery) {
        this.logT = 0;
        console.log(
          `[paintball] steer=${frame.steer.toFixed(2)} -> strafe=${strafe.toFixed(2)} | ` +
            `roll=${frame.roll.toFixed(1)} -> forward=${forward.toFixed(2)} | ` +
            `squeeze=${squeeze.toFixed(2)} armed=${this.armed}${fired ? " FIRE" : ""}`
        );
      }
    }

    return { forward, strafe, fired, live: true };
  }
}
