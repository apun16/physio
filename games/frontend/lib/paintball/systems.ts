import type { TargetKind } from "./types";

export class ScoreManager {
  score = 0;
  combo = 1;
  longestCombo = 1;
  hits = 0;
  misses = 0;
  defeats = 0;
  survival = 0;
  coverageHits = 0;
  waveClean = true;

  get accuracy() {
    const total = this.hits + this.misses;
    return total ? this.hits / total : 1;
  }

  hit(center: boolean, moving: boolean) {
    this.hits += 1;
    const gain = Math.round((50 + (center ? 30 : 0) + (moving ? 25 : 0)) * this.combo);
    this.score += gain;
    this.combo = Math.min(8, this.combo + 0.25);
    this.longestCombo = Math.max(this.longestCombo, this.combo);
    return gain;
  }

  defeat() {
    this.defeats += 1;
    const gain = Math.round(90 * this.combo);
    this.score += gain;
    return gain;
  }

  miss() {
    this.misses += 1;
    this.combo = 1;
  }

  paint(fresh: boolean) {
    if (!fresh) return 0;
    this.coverageHits += 1;
    const gain = Math.round(8 * this.combo);
    this.score += gain;
    return gain;
  }

  dodge() {
    const gain = Math.round(40 * this.combo);
    this.score += gain;
    this.combo = Math.min(8, this.combo + 0.12);
    this.longestCombo = Math.max(this.longestCombo, this.combo);
    return gain;
  }

  hurt() {
    this.combo = 1;
    this.waveClean = false;
  }

  waveClear(wave: number) {
    const bonus = 140 * wave + (this.waveClean ? 220 : 0);
    this.score += bonus;
    this.waveClean = true;
    return bonus;
  }

  reset() {
    this.score = 0;
    this.combo = 1;
    this.longestCombo = 1;
    this.hits = 0;
    this.misses = 0;
    this.defeats = 0;
    this.survival = 0;
    this.coverageHits = 0;
    this.waveClean = true;
  }
}

export type Difficulty = {
  wave: number;
  maxAlive: number;
  warning: number;
  projectileSpeed: number;
  spawnGap: number;
  moveChance: number;
  armourChance: number;
  lanes: Array<"left" | "center" | "right">;
  heights: Array<"low" | "mid" | "high">;
};

export class DifficultyManager {
  params(wave: number, survival: number, accuracy: number): Difficulty {
    const later = Math.max(0, wave - 6);
    return {
      wave,
      maxAlive: wave <= 2 ? 1 : wave <= 4 ? 2 : wave <= 6 ? 3 : Math.min(5, 3 + Math.floor(later / 2)),
      warning: Math.max(0.65, 1.85 - wave * 0.1 - later * 0.03),
      projectileSpeed: Math.min(14, 3.2 + wave * 0.5 + (accuracy > 0.85 ? 0.3 : 0) + survival * 0.006),
      spawnGap: Math.max(0.55, 2.05 - wave * 0.13),
      moveChance: wave <= 2 ? 0 : wave <= 4 ? 0.4 : 0.65,
      armourChance: wave <= 4 ? 0 : wave <= 6 ? 0.32 : 0.48,
      lanes: wave <= 2 ? ["center"] : ["center", "left", "right"],
      heights: wave <= 4 ? ["mid"] : ["low", "mid", "high"]
    };
  }
}

export class WaveManager {
  wave = 1;
  remaining = 4;
  spawned = 0;
  private gap = 0;

  begin(count: number) {
    this.remaining = count;
    this.spawned = 0;
    this.gap = 0.25;
  }

  update(dt: number, alive: number, difficulty: Difficulty) {
    this.gap = Math.max(0, this.gap - dt);
    const want = Math.min(difficulty.maxAlive, this.remaining);
    if (this.remaining > 0 && alive < want && this.gap <= 0) {
      this.remaining -= 1;
      this.spawned += 1;
      this.gap = difficulty.spawnGap;
      return true;
    }
    return false;
  }

  complete(alive: number) {
    return this.remaining <= 0 && alive <= 0;
  }

  next() {
    this.wave += 1;
    this.begin(3 + this.wave);
  }

  reset() {
    this.wave = 1;
    this.begin(4);
  }
}

export function pickKind(moveChance: number, armourChance: number): TargetKind {
  if (Math.random() < armourChance) return "armoured";
  if (Math.random() < moveChance) return "moving";
  return "basic";
}
