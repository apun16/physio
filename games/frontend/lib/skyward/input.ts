import { sensorLog, type SerialSensor } from "../racing/sensor";

export type SlashDirection = "horizontal" | "vertical" | "diagonal";

export const VALID_SLASHES: SlashDirection[] = ["horizontal", "vertical", "diagonal"];

export type GameAction =
  | { type: "SwordSlash"; direction: SlashDirection; velocity: number }
  | { type: "ShieldState"; active: boolean }
  | { type: "BowAim"; x: number; y: number }
  | { type: "BowDraw"; amount: number }
  | { type: "BowRelease" };

export interface InputProvider {
  poll(): GameAction[];
}

export class IdleInputProvider implements InputProvider {
  poll(): GameAction[] {
    return [];
  }
}

/**
 * Gesture thresholds for the hardware controller.
 *
 * Field names match `games/backend/Hardware/Python/full.py`, which prints the
 * same stream: roll, pitch, yaw, steer, moveX, moveY, rawFsr, squeeze.
 */
export const IMU_TUNING = {
  /** Squeeze (0..1) above this draws the bow. */
  drawMin: 0.15,
  /**
   * Squeeze that counts as a full draw. The game discards a release below
   * bowDraw 0.38 (state.ts releaseBow), so a patient who can only reach ~0.3
   * would draw the bow and never loose. Scaling against a realistic maximum
   * rather than the theoretical 1.0 keeps a modest grip a usable shot.
   */
  fullDrawAt: 0.55,
  /** Easing back to this share of the peak squeeze looses the arrow. */
  releaseFraction: 0.7,
  /** ...or this much below the peak, whichever comes first. */
  releaseDrop: 0.1,
  /** A drop faster than this (draw units per second) looses immediately. */
  releaseRate: 1.2,
  /**
   * Which way a sweep has to go to swing the sword. "either" takes the
   * magnitude so it fires whichever sign the calibration produces — pin it to
   * "right" or "left" once the direction is confirmed on real data.
   */
  slashAxis: "either" as "either" | "right" | "left",
  /**
   * moveX is a cumulative distance from the calibration point, not a position
   * that springs back, so a slash is measured as growth away from a rolling
   * baseline rather than an absolute value.
   */
  slashAt: 0.25,
  /** Hard floor between slashes; the quiet gate below does the real work. */
  slashCooldown: 0.15,
  /**
   * Ask the device to re-zero (command 'c') after each slash so the next sweep
   * starts from a clean baseline. The baseline is also reset locally, so the
   * gesture still re-arms if the command does not land.
   */
  resetAfterSlash: true,
  /** Per-frame change below this counts as the hand having stopped. */
  settleQuiet: 0.02,
  /** Seconds of stillness that end a sweep and arm the next one. */
  rearmQuiet: 0.15,
  /**
   * Shield is off: pitch and the linear X sweep were tripping each other, and a
   * stuck shield also blocks the bow (state.ts apply() ignores BowDraw while
   * shielding). Flip to true to bring it back.
   */
  shieldEnabled: false,
  /**
   * Any large pitch deflection raises it, so it works whether raising the arm
   * reads as + or - pitch. Set false and use pitchSign once confirmed.
   */
  shieldUseMagnitude: true,
  /** Applied when shieldUseMagnitude is false; -1 flips a raised arm. */
  pitchSign: 1,
  /** Pitch (deg) that raises the shield... */
  shieldUp: 12,
  /** ...and the edge it must fall back through to drop it. */
  shieldDown: 6,
  /** Seconds between debug lines printed to the dev terminal. 0 disables. */
  logEvery: 0.25
};

/**
 * Maps the ESP-32 controller onto the three combat gestures:
 *   bow    — squeeze to draw, ease off to loose the arrow
 *   slash  — sweep the hand right, i.e. the linear moveX value crossing slashAt
 *   shield — raising the pitch angle, held while it stays raised
 *
 * Needs the 8-field firmware (htn_final.ino) for the force sensor; on the
 * 5-field sketch the bow stays idle and only slash and shield work.
 */
export class IMUInputProvider implements InputProvider {
  private lastT = 0;
  private peakDraw = 0;
  private lastSqueeze = 0;
  private baseX = 0;
  private lastX = 0;
  private haveBaseX = false;
  // Starts disarmed: the baseline must be taken from a hand at rest, otherwise
  // connecting mid-movement captures a baseline partway through a sweep and
  // swallows the first slash.
  private armed = false;
  private quietFor = 0;
  private slashCool = 0;
  private drawing = false;
  private shield = false;
  private logT = 0;
  private started = false;

  constructor(private sensor: SerialSensor) {}

  get live() {
    return this.sensor.isLive(performance.now());
  }

  /** The peak squeeze expressed as a draw the game will accept. */
  private peakDrawScaled() {
    return Math.min(1, this.peakDraw / Math.max(0.05, IMU_TUNING.fullDrawAt));
  }

  private reset() {
    this.started = false;
    this.drawing = false;
    this.peakDraw = 0;
    this.lastSqueeze = 0;
    this.haveBaseX = false;
    this.armed = false;
    this.quietFor = 0;
    this.slashCool = 0;
  }

  /** Ask the device to re-zero its cumulative distance. */
  recentre() {
    if (IMU_TUNING.resetAfterSlash) void this.sensor.send("center");
  }

  poll(): GameAction[] {
    const now = performance.now();
    if (!this.sensor.isLive(now)) {
      if (this.shield) {
        this.shield = false;
        this.reset();
        return [{ type: "ShieldState", active: false }];
      }
      this.reset();
      return [];
    }
    const frame = this.sensor.latest;
    if (!frame || frame.t === this.lastT) return [];
    const dt = this.started ? Math.max(0.001, (frame.t - this.lastT) / 1000) : 0;
    this.lastT = frame.t;

    const actions: GameAction[] = [];
    const moveX = frame.move;
    if (!this.haveBaseX) {
      this.baseX = moveX;
      this.lastX = moveX;
      this.haveBaseX = true;
    }
    // Growth away from the baseline, because moveX accumulates and never
    // springs back on its own.
    const deltaX = moveX - this.baseX;
    const sweep = IMU_TUNING.slashAxis === "right" ? deltaX : IMU_TUNING.slashAxis === "left" ? -deltaX : Math.abs(deltaX);
    const pitch = IMU_TUNING.shieldUseMagnitude ? Math.abs(frame.pitch) : frame.pitch * IMU_TUNING.pitchSign;
    const squeeze = frame.squeeze;

    // Shield: pitch angle raised, with hysteresis so it does not flicker.
    if (IMU_TUNING.shieldEnabled) {
      const raised = this.shield ? pitch > IMU_TUNING.shieldDown : pitch > IMU_TUNING.shieldUp;
      if (raised !== this.shield) {
        this.shield = raised;
        actions.push({ type: "ShieldState", active: raised });
        sensorLog(`zelda SHIELD ${raised ? "UP" : "DOWN"} (pitch=${pitch.toFixed(2)})`);
      }
    } else if (this.shield) {
      // Make sure a shield raised before it was disabled cannot stay stuck up.
      this.shield = false;
      actions.push({ type: "ShieldState", active: false });
    }

    // Slash: growth of the cumulative X distance away from its baseline. After
    // firing, both the local baseline and the device are re-zeroed so the next
    // sweep is measured from scratch.
    this.slashCool = Math.max(0, this.slashCool - dt);
    const step = Math.abs(moveX - this.lastX);
    this.lastX = moveX;
    if (!this.armed) {
      // One slash per sweep: the hand has to come to rest before the next one
      // arms. Holding the baseline at the live value meanwhile absorbs the
      // jump back to zero when the device acts on the 'c'.
      this.baseX = moveX;
      this.quietFor = step < IMU_TUNING.settleQuiet ? this.quietFor + dt : 0;
      if (this.quietFor >= IMU_TUNING.rearmQuiet) {
        this.armed = true;
        this.quietFor = 0;
      }
    } else if (this.slashCool <= 0 && sweep >= IMU_TUNING.slashAt) {
      const reach = Math.min(1, (sweep - IMU_TUNING.slashAt) / Math.max(0.01, 1 - IMU_TUNING.slashAt));
      actions.push({ type: "SwordSlash", direction: "horizontal", velocity: 0.55 + reach * 0.45 });
      sensorLog(`zelda SLASH (X=${moveX.toFixed(2)} base=${this.baseX.toFixed(2)} sweep=${sweep.toFixed(2)}) -> recentre`);
      this.slashCool = IMU_TUNING.slashCooldown;
      this.armed = false;
      this.quietFor = 0;
      this.baseX = moveX;
      this.recentre();
    }

    // Bow: squeeze draws, easing off looses.
    if (squeeze !== null) {
      // Scale to a draw the game will accept: see fullDrawAt.
      const draw = Math.min(1, squeeze / Math.max(0.05, IMU_TUNING.fullDrawAt));
      const dropRate = dt > 0 ? (this.lastSqueeze - squeeze) / dt : 0;
      if (this.drawing) {
        const floor = Math.min(this.peakDraw * IMU_TUNING.releaseFraction, this.peakDraw - IMU_TUNING.releaseDrop);
        // Pressure high then suddenly low looses the arrow, whether that shows
        // up as falling under the floor or as one fast drop between frames.
        const sharp = dropRate >= IMU_TUNING.releaseRate;
        if (squeeze <= floor || squeeze < IMU_TUNING.drawMin || sharp) {
          sensorLog(
            `zelda BOW RELEASE peak=${this.peakDraw.toFixed(2)} -> ${squeeze.toFixed(2)}` +
              ` (floor=${floor.toFixed(2)} dropRate=${dropRate.toFixed(2)}${sharp ? " SHARP" : ""}) draw sent=${this.peakDrawScaled().toFixed(2)}`
          );
          // Hand the game the peak draw first: releaseBow() reads hero.bowDraw,
          // and anything under 0.38 there is silently discarded.
          actions.push({ type: "BowDraw", amount: this.peakDrawScaled() });
          actions.push({ type: "BowRelease" });
          actions.push({ type: "BowDraw", amount: 0 });
          this.drawing = false;
          this.peakDraw = 0;
        } else {
          this.peakDraw = Math.max(this.peakDraw, squeeze);
          actions.push({ type: "BowDraw", amount: draw });
        }
      } else if (squeeze >= IMU_TUNING.drawMin) {
        this.drawing = true;
        this.peakDraw = squeeze;
        actions.push({ type: "BowDraw", amount: draw });
        sensorLog(`zelda BOW DRAW start (squeeze=${squeeze.toFixed(2)} -> draw=${draw.toFixed(2)})`);
      }
      this.lastSqueeze = squeeze;
    }

    actions.push({ type: "BowAim", x: 1, y: Math.max(-1, Math.min(1, frame.moveY ?? 0)) });

    // Same columns full.py prints, so the two can be compared side by side.
    if (IMU_TUNING.logEvery > 0) {
      this.logT += dt;
      if (this.logT >= IMU_TUNING.logEvery) {
        this.logT = 0;
        sensorLog(
          `zelda roll=${frame.roll.toFixed(2)} pitch=${frame.pitch.toFixed(2)} yaw=${frame.yaw.toFixed(2)} steer=${frame.steer.toFixed(2)}` +
            ` | X=${moveX.toFixed(2)} Y=${(frame.moveY ?? 0).toFixed(2)}` +
            ` | FSR=${frame.rawFsr ?? "-"} squeeze=${squeeze === null ? "-" : squeeze.toFixed(3)}` +
            `(${squeeze === null ? "-" : Math.round(squeeze * 255)}/255)` +
            ` || baseX=${this.baseX.toFixed(2)} sweep=${sweep.toFixed(2)}/${IMU_TUNING.slashAt}` +
            `${this.armed ? " ready" : ` sweeping(quiet ${this.quietFor.toFixed(2)}s)`}` +
            ` pitch=${pitch.toFixed(1)} shield=${IMU_TUNING.shieldEnabled ? String(this.shield) : "off"}` +
            ` draw=${this.drawing ? this.peakDraw.toFixed(2) : "-"}`
        );
      }
    }

    this.started = true;
    return actions;
  }
}

export class DebugInputProvider implements InputProvider {
  private keys = new Set<string>();
  private shield = false;
  private drawing = false;
  private draw = 0;
  private aim = { x: 1, y: 0 };
  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const key = this.normalizeKey(event);
    if (!key) return;
    const combat = ["j", "k", "l", "1", "2", "3", "f", "e", "shift"];
    if (combat.includes(key)) event.preventDefault();
    this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    const key = this.normalizeKey(event);
    if (key) this.keys.delete(key);
  };

  private normalizeKey(event: KeyboardEvent) {
    const codes: Record<string, string> = {
      KeyJ: "j",
      KeyK: "k",
      KeyL: "l",
      KeyF: "f",
      KeyE: "e",
      Digit1: "1",
      Digit2: "2",
      Digit3: "3",
      ShiftLeft: "shift",
      ShiftRight: "shift"
    };
    return codes[event.code] ?? event.key.toLowerCase();
  }

  private onMove = (event: MouseEvent) => {
    const rect = this.canvas?.getBoundingClientRect();
    const width = rect?.width ?? 1280;
    const height = rect?.height ?? 720;
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    this.aim = {
      x: Math.max(-1, Math.min(1, ((event.clientX - left) / width - 0.45) * 2)),
      y: Math.max(-1, Math.min(1, -((event.clientY - top) / height - 0.55) * 2))
    };
  };

  private onMouseDown = (event: MouseEvent) => {
    if (event.button === 2) this.keys.add("e");
  };

  private onMouseUp = (event: MouseEvent) => {
    if (event.button === 2) this.keys.delete("e");
  };

  poll(): GameAction[] {
    const actions: GameAction[] = [];
    if (this.keys.delete("j") || this.keys.delete("1")) {
      actions.push({ type: "SwordSlash", direction: "horizontal", velocity: 0.92 });
    }
    if (this.keys.delete("k") || this.keys.delete("2")) {
      actions.push({ type: "SwordSlash", direction: "vertical", velocity: 0.95 });
    }
    if (this.keys.delete("l") || this.keys.delete("3")) {
      actions.push({ type: "SwordSlash", direction: "diagonal", velocity: 0.88 });
    }

    const shield = this.keys.has("f") || this.keys.has("shift");
    if (shield !== this.shield) {
      this.shield = shield;
      actions.push({ type: "ShieldState", active: shield });
    }

    actions.push({ type: "BowAim", x: this.aim.x, y: this.aim.y });

    const drawing = this.keys.has("e");
    if (drawing) {
      this.draw = Math.min(1, this.draw + 0.045);
      this.drawing = true;
      actions.push({ type: "BowDraw", amount: this.draw });
    } else if (this.drawing) {
      this.drawing = false;
      actions.push({ type: "BowRelease" });
      this.draw = 0;
      actions.push({ type: "BowDraw", amount: 0 });
    }

    return actions;
  }
}
