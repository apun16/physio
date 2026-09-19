import type { DodgeState } from "./types";

export class PlayerHitbox {
  state: DodgeState = "CENTER";
  invuln = 0;

  setPlayerMovementState(state: DodgeState) {
    this.state = state;
  }

  updatePlayerHitbox(state: DodgeState) {
    this.setPlayerMovementState(state);
  }

  offset() {
    const x = this.state === "LEFT" ? -0.7 : this.state === "RIGHT" ? 0.7 : 0;
    const y = this.state === "DUCK" ? 0.52 : 1.28;
    const h = this.state === "DUCK" ? 0.36 : 0.8;
    return { x, y, h, w: 0.28 };
  }

  contains(x: number, y: number, z: number) {
    const box = this.offset();
    return Math.abs(x - box.x) < box.w && Math.abs(y - box.y) < box.h && z > -1.2 && z < 0.4;
  }
}

export class ExternalMovementInput {
  private listener: ((state: DodgeState) => void) | null = null;
  private keys = new Set<string>();

  registerExternalDodgeInput(listener: (state: DodgeState) => void) {
    this.listener = listener;
  }

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
  }

  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
  }

  private emit() {
    const left = this.keys.has("a") || this.keys.has("arrowleft");
    const right = this.keys.has("d") || this.keys.has("arrowright");
    const duck = this.keys.has("s") || this.keys.has("arrowdown");
    const state: DodgeState = duck ? "DUCK" : left ? "LEFT" : right ? "RIGHT" : "CENTER";
    this.listener?.(state);
  }

  private onDown = (event: KeyboardEvent) => {
    this.keys.add(event.key.toLowerCase());
    this.emit();
  };

  private onUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
    this.emit();
  };
}
