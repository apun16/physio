/**
 * Hardware controller mapping for Inkburst.
 *
 *   squeeze -> shoot
 *   steer   -> move left and right
 *   roll    -> move forward and back
 *
 * Aiming stays on the mouse.
 *
 * Everything here is measured RELATIVE to what the device is actually sending,
 * not to absolute thresholds. An uncalibrated FSR can rest at 0.6 and an
 * uncalibrated IMU can rest at 20 degrees of roll, which with fixed thresholds
 * means the trigger never re-arms and the player drifts forward forever. The
 * controller learns its own resting point instead.
 */

import type { SerialSensor } from "../racing/sensor";

export const PAINTBALL_TUNING = {
  /** Deadzone around the learned resting point, in steer units. */
  steerDeadzone: 0.1,
  /** Travel past the deadzone that counts as full left or right. */
  steerFull: 0.6,
  /** Deadzone around the learned resting roll, in degrees. */
  rollDeadzone: 6,
  /** Degrees past the deadzone that count as a full push. */
  rollFull: 28,
  /** Share of the observed squeeze range that pulls the trigger. */
  fireAt: 0.55,
  /** Falling back to this share of the range re-arms it. */
  fireRearm: 0.3,
  /** The squeeze range has to be at least this wide to be believable. */
  minSqueezeSpan: 0.06,
  /** Flip if a direction runs backwards. */
  steerSign: 1,
  rollSign: 1
};

function axis(value: number, deadzone: number, full: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - deadzone) / Math.max(0.0001, full));
}

export type HardwareMove = {
  forward: number;
  strafe: number;
  fired: boolean;
  live: boolean;
};

/** Everything the on-screen readout needs to explain what the device is doing. */
export type HardwareDebug = {
  live: boolean;
  rawSteer: number;
  rawRoll: number;
  rawSqueeze: number;
  restRoll: number;
  restSteer: number;
  squeezeLow: number;
  squeezeHigh: number;
  squeezeNorm: number;
  forward: number;
  strafe: number;
  armed: boolean;
  shots: number;
};

const IDLE: HardwareMove = { forward: 0, strafe: 0, fired: false, live: false };

export class PaintballHardware {
  private restRoll: number | null = null;
  private restSteer: number | null = null;
  private squeezeLow = Number.POSITIVE_INFINITY;
  private squeezeHigh = Number.NEGATIVE_INFINITY;
  private armed = true;
  private shots = 0;

  debug: HardwareDebug = {
    live: false, rawSteer: 0, rawRoll: 0, rawSqueeze: 0, restRoll: 0, restSteer: 0,
    squeezeLow: 0, squeezeHigh: 0, squeezeNorm: 0, forward: 0, strafe: 0, armed: true, shots: 0
  };

  constructor(private sensor: SerialSensor) {}

  get live() {
    return this.sensor.isLive(performance.now());
  }

  /** Take the current pose as the new neutral. Called when a match starts. */
  recentre() {
    this.restRoll = null;
    this.restSteer = null;
    this.squeezeLow = Number.POSITIVE_INFINITY;
    this.squeezeHigh = Number.NEGATIVE_INFINITY;
    this.armed = true;
  }

  poll(_dt: number): HardwareMove {
    const frame = this.sensor.latest;
    if (!this.sensor.isLive(performance.now()) || !frame) {
      this.debug = { ...this.debug, live: false, forward: 0, strafe: 0 };
      return IDLE;
    }

    // First live frame defines neutral for the motion axes.
    if (this.restRoll === null) this.restRoll = frame.roll;
    if (this.restSteer === null) this.restSteer = frame.steer;

    const rollDelta = (frame.roll - this.restRoll) * PAINTBALL_TUNING.rollSign;
    const steerDelta = (frame.steer - this.restSteer) * PAINTBALL_TUNING.steerSign;
    const forward = axis(rollDelta, PAINTBALL_TUNING.rollDeadzone, PAINTBALL_TUNING.rollFull);
    const strafe = axis(steerDelta, PAINTBALL_TUNING.steerDeadzone, PAINTBALL_TUNING.steerFull);

    // The trigger learns the grip range as it is used, so it works whether the
    // FSR rests near 0 or near 1 and whatever the patient's maximum is.
    const raw = frame.squeeze ?? 0;
    this.squeezeLow = Math.min(this.squeezeLow, raw);
    this.squeezeHigh = Math.max(this.squeezeHigh, raw);
    const span = this.squeezeHigh - this.squeezeLow;
    const usable = span >= PAINTBALL_TUNING.minSqueezeSpan;
    const norm = usable ? (raw - this.squeezeLow) / span : 0;

    let fired = false;
    if (usable) {
      if (this.armed && norm >= PAINTBALL_TUNING.fireAt) {
        fired = true;
        this.armed = false;
        this.shots += 1;
      } else if (!this.armed && norm <= PAINTBALL_TUNING.fireRearm) {
        this.armed = true;
      }
    }

    this.debug = {
      live: true,
      rawSteer: frame.steer,
      rawRoll: frame.roll,
      rawSqueeze: raw,
      restRoll: this.restRoll,
      restSteer: this.restSteer,
      squeezeLow: Number.isFinite(this.squeezeLow) ? this.squeezeLow : 0,
      squeezeHigh: Number.isFinite(this.squeezeHigh) ? this.squeezeHigh : 0,
      squeezeNorm: norm,
      forward,
      strafe,
      armed: this.armed,
      shots: this.shots
    };

    return { forward, strafe, fired, live: true };
  }
}
