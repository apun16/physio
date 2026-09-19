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

/** Later: parse IMU packets into the same GameAction types. */
export class IMUInputProvider implements InputProvider {
  poll(): GameAction[] {
    return [];
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
