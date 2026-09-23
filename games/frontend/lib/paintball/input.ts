import type { AimSample, ImuSample, InputMode, SqueezePhase } from "./types";
import type { HardwareMove } from "./hardware";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class IMUAimingController {
  sensitivity = { x: 1.55, y: 1.25 };
  deadzone = 0.04;
  private neutral = { pitch: 0, yaw: 0, roll: 0 };
  private filtered = { pitch: 0, yaw: 0, roll: 0 };
  private last = { pitch: 0, yaw: 0, roll: 0 };
  aim: AimSample = { x: 0, y: 0 };

  calibrate(sample: ImuSample) {
    this.neutral = { ...sample.orientation };
    this.filtered = { ...sample.orientation };
    this.last = { ...sample.orientation };
  }

  update(sample: ImuSample, dt: number, tracking: boolean) {
    if (!tracking) return this.aim;
    const next = { ...sample.orientation };
    const spike = Math.abs(next.pitch - this.last.pitch) + Math.abs(next.yaw - this.last.yaw) + Math.abs(next.roll - this.last.roll);
    if (spike < 1.35) this.last = next;
    const src = spike >= 1.35 ? this.last : next;
    const alpha = 1 - Math.exp(-12 * dt);
    this.filtered.pitch = lerp(this.filtered.pitch, src.pitch, alpha);
    this.filtered.yaw = lerp(this.filtered.yaw, src.yaw, alpha);
    this.filtered.roll = lerp(this.filtered.roll, src.roll, alpha);
    let yaw = this.filtered.yaw - this.neutral.yaw;
    let pitch = this.filtered.pitch - this.neutral.pitch;
    if (Math.abs(yaw) < this.deadzone) yaw = 0;
    if (Math.abs(pitch) < this.deadzone) pitch = 0;
    this.aim.x = clamp(yaw * this.sensitivity.x, -1, 1);
    this.aim.y = clamp(-pitch * this.sensitivity.y, -1, 1);
    return this.aim;
  }
}

export class SqueezeAimController {
  press = 0.65;
  release = 0.35;
  cooldown = 0.2;
  phase: SqueezePhase = "READY";
  private cool = 0;

  update(_squeeze: number, dt: number) {
    this.cool = Math.max(0, this.cool - dt);
    return { fired: false, phase: this.phase, aiming: false };
  }

  reset() {
    this.phase = "READY";
    this.cool = 0;
  }
}

export class SensorConnection {
  status: "off" | "sim" | "live" | "lost" = "off";
  sample: ImuSample = { orientation: { pitch: 0, yaw: 0, roll: 0 }, squeeze: 0, timestamp: 0 };
  connect() {
    this.status = "off";
  }
  disconnect() {
    this.status = "off";
  }
}

export class InputSimulator {
  pitch = 0;
  yaw = 0;
  roll = 0;
  squeeze = 0;
  connected = false;
  noise = false;
  sample(): ImuSample {
    return { orientation: { pitch: this.pitch, yaw: this.yaw, roll: this.roll }, squeeze: this.squeeze, timestamp: performance.now() };
  }
}

export class InputManager {
  mode: InputMode = "kbm";
  mouse = { x: 0, y: 0, down: false };
  keys = new Set<string>();
  imu = new IMUAimingController();
  squeeze = new SqueezeAimController();
  socket = new SensorConnection();
  sim = new InputSimulator();
  yaw = 0;
  pitch = 0;
  locked = false;
  looking = false;
  /** Set by the game: only capture the cursor while a match is actually running. */
  allowCapture: () => boolean = () => true;
  /** Set by the game: fired when the cursor is released (Esc, alt-tab, focus loss). */
  onLockLost: (() => void) | null = null;
  /** Set by the game: the controller's movement and trigger for this frame. */
  hardware: (dt: number) => HardwareMove = () => ({ forward: 0, strafe: 0, fired: false, live: false });
  private element: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private clicked = false;
  private lookSense = 0.0022;
  /** Set when the browser refuses pointer lock; mouse look falls back to drag. */
  private dragLook = false;
  private lockWait = 0;

  attach(element: HTMLElement, canvas?: HTMLCanvasElement) {
    this.element = element;
    this.canvas = canvas ?? element.querySelector("canvas");
    element.tabIndex = 0;
    element.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onLock);
  }

  detach() {
    this.releasePointer();
    this.element?.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onLock);
  }

  setMode(mode: InputMode) {
    this.mode = "kbm";
    this.socket.status = "off";
    void mode;
  }

  capturePointer() {
    if (!this.allowCapture()) return;
    this.looking = true;
    this.dragLook = false;
    try {
      const result = this.canvas?.requestPointerLock();
      if (result && typeof (result as Promise<void>).then === "function") {
        void result.catch(() => {
          this.dragLook = true;
        });
      }
    } catch {
      this.dragLook = true;
    }
    // Some browsers reject the request silently, so confirm it actually took.
    window.clearTimeout(this.lockWait);
    this.lockWait = window.setTimeout(() => {
      if (this.looking && !this.locked) this.dragLook = true;
    }, 300);
  }

  releasePointer() {
    this.looking = false;
    this.dragLook = false;
    window.clearTimeout(this.lockWait);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onLock = () => {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.dragLook = false;
    if (wasLocked && !this.locked) {
      // The cursor is free again, so stop steering with it and let the game react.
      this.looking = false;
      this.dragLook = false;
      this.onLockLost?.();
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, .paint-card, .paint-debug, .paint-top, .paint-foot")) return;
    this.mouse.down = true;
    this.element?.focus();
    if (!this.allowCapture()) return;
    this.clicked = true;
    this.capturePointer();
  };

  private onPointerUp = (event: PointerEvent) => {
    if (event.button === 0) this.mouse.down = false;
  };

  private onMouseMove = (event: MouseEvent) => {
    // Only steer while the cursor is genuinely captured. Steering on hover or
    // on a held button meant the view kept spinning after the player pressed
    // Esc and moved the free cursor toward the HUD.
    // Drag-to-look is the fallback when the browser refused to lock the cursor;
    // it still never steers on a plain hover.
    if (!this.locked && !(this.dragLook && this.mouse.down && this.allowCapture())) return;
    this.yaw -= event.movementX * this.lookSense;
    this.pitch -= event.movementY * this.lookSense;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    this.keys.add(key);
    const blocking = event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement;
    if (!blocking && [" ", "arrowleft", "arrowright", "arrowdown", "arrowup"].includes(key)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };

  poll(dt: number) {
    const keyForward = (this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0) - (this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0);
    const keyStrafe = (this.keys.has("arrowright") || this.keys.has("d") ? 1 : 0) - (this.keys.has("arrowleft") || this.keys.has("a") ? 1 : 0);

    // The controller and the keyboard both feed the same axes. Whichever is
    // pushed further wins, so plugging in the hardware never disables the keys.
    const pad = this.hardware(dt);
    const pick = (key: number, hw: number) => (Math.abs(hw) > Math.abs(key) ? hw : key);
    const forward = clamp(pick(keyForward, pad.forward), -1, 1);
    const strafe = clamp(pick(keyStrafe, pad.strafe), -1, 1);

    const fired = this.clicked || pad.fired;
    this.clicked = false;
    return {
      aim: { x: this.yaw, y: this.pitch },
      sample: this.sim.sample(),
      fired,
      aiming: false,
      phase: this.squeeze.phase,
      squeezeValue: 0,
      forward,
      strafe,
      locked: this.locked,
      hardwareLive: pad.live
    };
  }
}
