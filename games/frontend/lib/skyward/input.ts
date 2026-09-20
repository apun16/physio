import type { SerialSensor } from "../racing/sensor";

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
 * Gesture thresholds for the hardware controller. All are deliberately generous
 * so a slow, deliberate rehab movement still registers.
 */
export const IMU_TUNING = {
  /** Squeeze (0..1) above this counts as drawing the bow. */
  drawMin: 0.18,
  /** Easing off this far below the peak squeeze looses the arrow. */
  releaseDrop: 0.12,
  /** Pitch in degrees above neutral that raises the shield... */
  shieldUp: 14,
  /** ...and the lower edge it has to fall back through to drop it (hysteresis). */
  shieldDown: 8,
  /** Rightward move-X rate, units per second, that counts as a slash. */
  slashRate: 1.4,
  /** Minimum gap between slashes, seconds. */
  slashCooldown: 0.45
};

/**
 * Maps the ESP-32 controller onto the three combat gestures:
 *   bow    — squeeze to draw, ease off to loose the arrow
 *   slash  — a linear move of the hand to the right
 *   shield — raising the pitch angle, held while it stays raised
 *
 * Needs the 8-field firmware (htn_final.ino) for the force sensor; on the
 * 5-field sketch the bow stays idle and only slash and shield work.
 */
export class IMUInputProvider implements InputProvider {
  private lastT = 0;
  private lastMoveX = 0;
  private peakDraw = 0;
  private drawing = false;
  private shield = false;
  private slashCool = 0;
  private started = false;

  constructor(private sensor: SerialSensor) {}

  /** True once a fresh frame has been seen; drives the "controller live" readout. */
  get live() {
    return this.sensor.isLive(performance.now());
  }

  private reset() {
    this.started = false;
    this.drawing = false;
    this.peakDraw = 0;
    this.slashCool = 0;
  }

  poll(): GameAction[] {
    const now = performance.now();
    if (!this.sensor.isLive(now)) {
      // Drop the shield rather than leave it stuck up on a dead controller.
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
    this.slashCool = Math.max(0, this.slashCool - dt);

    // Shield: pitch angle rising, with hysteresis so it does not flicker.
    const raised = this.shield ? frame.pitch > IMU_TUNING.shieldDown : frame.pitch > IMU_TUNING.shieldUp;
    if (raised !== this.shield) {
      this.shield = raised;
      actions.push({ type: "ShieldState", active: raised });
    }

    // Slash: a rightward linear move of the hand.
    if (this.started && this.slashCool <= 0) {
      const rate = (frame.move - this.lastMoveX) / dt;
      if (rate >= IMU_TUNING.slashRate) {
        this.slashCool = IMU_TUNING.slashCooldown;
        actions.push({
          type: "SwordSlash",
          direction: "horizontal",
          // A just-threshold sweep lands on STRONG_HIT; faster scales to full.
          velocity: Math.min(1, 0.5 + (rate - IMU_TUNING.slashRate) / (IMU_TUNING.slashRate * 2))
        });
      }
    }
    this.lastMoveX = frame.move;

    // Bow: squeeze draws, easing off looses.
    const squeeze = frame.squeeze;
    if (squeeze !== null) {
      const eased = this.drawing && this.peakDraw - squeeze >= IMU_TUNING.releaseDrop;
      if (this.drawing && (squeeze < IMU_TUNING.drawMin || eased)) {
        this.drawing = false;
        this.peakDraw = 0;
        actions.push({ type: "BowRelease" });
        actions.push({ type: "BowDraw", amount: 0 });
      } else if (squeeze >= IMU_TUNING.drawMin) {
        this.drawing = true;
        this.peakDraw = Math.max(this.peakDraw, squeeze);
        actions.push({ type: "BowDraw", amount: squeeze });
      }
    }

    // Aim rides the vertical move axis; the other axes are spoken for.
    actions.push({ type: "BowAim", x: 1, y: Math.max(-1, Math.min(1, frame.moveY ?? 0)) });

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
