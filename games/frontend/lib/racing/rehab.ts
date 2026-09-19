/**
 * Rehab layer for the racing game: difficulty profiles, per-session metrics,
 * a next-step recommendation, and a local session log.
 *
 * Progressive rehab is data-driven: a level is just a RehabProfile. Today the
 * game runs one profile; a therapist UI or backend can later supply its own
 * profile (or tweak the advance thresholds) without touching game code.
 */

export interface RehabProfile {
  level: number;
  label: string;
  /** How far from centre (road units, 1 = full ROM) coins sit. Bigger = more range of motion needed. */
  laneSpread: number;
  /** Half-width of the coin pickup window. Smaller = more precision needed. */
  pickupWindow: number;
  /** Session results needed before we recommend the next level. */
  advance: { minAccuracy: number; minOnRoad: number; minSmoothness: number };
  /** true when laneSpread/pickupWindow carry AI-proposed values the player accepted */
  tuned?: boolean;
}

export const LEVELS: RehabProfile[] = [
  { level: 1, label: "Gentle", laneSpread: 0.4, pickupWindow: 0.34, advance: { minAccuracy: 0.8, minOnRoad: 0.9, minSmoothness: 55 } },
  { level: 2, label: "Steady", laneSpread: 0.55, pickupWindow: 0.3, advance: { minAccuracy: 0.8, minOnRoad: 0.9, minSmoothness: 60 } },
  { level: 3, label: "Strong", laneSpread: 0.7, pickupWindow: 0.26, advance: { minAccuracy: 0.8, minOnRoad: 0.9, minSmoothness: 65 } },
  { level: 4, label: "Full range", laneSpread: 0.85, pickupWindow: 0.22, advance: { minAccuracy: 0.85, minOnRoad: 0.92, minSmoothness: 70 } }
];

export const ROAD_HALF_WIDTH = 0.92;

/** Hard limits for AI-tuned settings and the biggest change allowed per session. */
export const TUNING_BOUNDS = {
  laneSpread: { min: 0.3, max: 0.9, maxStep: 0.1 },
  pickupWindow: { min: 0.2, max: 0.36, maxStep: 0.04 }
} as const;

const LEVEL_KEY = "physio.racing.level";
const LOG_KEY = "physio.racing.sessions";
const TUNING_KEY = "physio.racing.tuning";

function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export interface Tuning { level: number; laneSpread: number; pickupWindow: number }

export function loadProfile(): RehabProfile {
  const saved = Number(readStorage(LEVEL_KEY));
  const base = LEVELS[Number.isInteger(saved) && saved >= 1 && saved <= LEVELS.length ? saved - 1 : 0];
  try {
    const tuning = JSON.parse(readStorage(TUNING_KEY) || "null") as Tuning | null;
    if (tuning && tuning.level === base.level && Number.isFinite(tuning.laneSpread) && Number.isFinite(tuning.pickupWindow)) {
      const { laneSpread: l, pickupWindow: w } = TUNING_BOUNDS;
      return {
        ...base,
        tuned: true,
        laneSpread: Math.max(l.min, Math.min(l.max, tuning.laneSpread)),
        pickupWindow: Math.max(w.min, Math.min(w.max, tuning.pickupWindow))
      };
    }
  } catch { /* corrupt tuning: fall back to the stock level */ }
  return base;
}

/** Changing level drops any AI tuning so the new level starts from its stock settings. */
export function saveLevel(level: number) {
  writeStorage(LEVEL_KEY, String(level));
  writeStorage(TUNING_KEY, "");
}

export function saveTuning(tuning: Tuning) {
  writeStorage(TUNING_KEY, JSON.stringify(tuning));
}

export function clearTuning() {
  writeStorage(TUNING_KEY, "");
}

export interface SessionSummary {
  date: string;
  level: number;
  durationSec: number;
  coins: number;
  coinsOffered: number;
  /** coins / coinsOffered, 0..1 */
  accuracy: number;
  /** share of time on the road, 0..1 */
  onRoad: number;
  /** 0..100, higher = smoother, steadier motion. Rough score; tune against real patient data. */
  smoothness: number;
  /** completed side-to-side sweeps */
  sweeps: number;
  /** peak forearm rotation reached each way, degrees */
  peakRightDeg: number;
  peakLeftDeg: number;
  signalDrops: number;
  /** difficulty settings this session ran with (absent in older logs) */
  laneSpread?: number;
  pickupWindow?: number;
  /** 0..100 similarity to the optimal coin line; only set when the camera tracked the hand */
  pathScore?: number;
}

export type Recommendation = { action: "advance" | "repeat" | "ease"; reason: string };

export function recommend(summary: SessionSummary, profile: RehabProfile): Recommendation {
  const { minAccuracy, minOnRoad, minSmoothness } = profile.advance;
  if (summary.accuracy >= minAccuracy && summary.onRoad >= minOnRoad && summary.smoothness >= minSmoothness) {
    return profile.level < LEVELS.length
      ? { action: "advance", reason: "Accurate, on the road and smooth. Ready for a wider range." }
      : { action: "repeat", reason: "Top level cleared. Keep building consistency." };
  }
  if (summary.accuracy < 0.4 && profile.level > 1) {
    return { action: "ease", reason: "Coins were hard to reach. A smaller range may feel better." };
  }
  return { action: "repeat", reason: "Repeat this level to build control before moving on." };
}

/** Smoothness score: mean lateral acceleration (road units/s^2) mapped so 0 = 100 and >= JERK_LIMIT = 0. */
const JERK_LIMIT = 14;
const SWEEP_LATCH = 0.5; // fraction of the level's lane spread the car must reach to count a side

export class RehabRecorder {
  private time = 0;
  private roadTime = 0;
  private jerkSum = 0;
  private jerkSamples = 0;
  private lastX = 0;
  private lastVelocity = 0;
  private started = false;
  private side: -1 | 0 | 1 = 0;
  private sweeps = 0;
  private peakRight = 0;
  private peakLeft = 0;
  private drops = 0;

  constructor(private profile: RehabProfile) {}

  /** Call once per running frame. `steer` is in game space (+ = right). */
  update(dt: number, x: number, steer: number, rollDeg: number) {
    if (dt <= 0) return;
    this.time += dt;
    if (Math.abs(x) <= ROAD_HALF_WIDTH) this.roadTime += dt;

    const velocity = this.started ? (x - this.lastX) / dt : 0;
    if (this.started) {
      this.jerkSum += Math.abs(velocity - this.lastVelocity); // sum of |dv| / total time = mean acceleration
      this.jerkSamples += dt;
    }
    this.lastX = x;
    this.lastVelocity = velocity;
    this.started = true;

    const latch = this.profile.laneSpread * SWEEP_LATCH;
    const nextSide = x > latch ? 1 : x < -latch ? -1 : this.side;
    if (this.side !== 0 && nextSide !== this.side) this.sweeps += 1;
    this.side = nextSide;

    if (steer > 0) this.peakRight = Math.max(this.peakRight, Math.abs(rollDeg));
    if (steer < 0) this.peakLeft = Math.max(this.peakLeft, Math.abs(rollDeg));
  }

  signalDropped() {
    this.drops += 1;
  }

  summarize(coins: number, distance: number, coinSpacing: number): SessionSummary {
    const coinsOffered = Math.max(1, Math.floor(distance / coinSpacing));
    const meanJerk = this.jerkSamples > 0 ? this.jerkSum / this.jerkSamples : 0;
    return {
      date: new Date().toISOString(),
      level: this.profile.level,
      durationSec: this.time,
      coins,
      coinsOffered,
      accuracy: Math.min(1, coins / coinsOffered),
      onRoad: this.time > 0 ? this.roadTime / this.time : 1,
      smoothness: Math.round(100 * (1 - Math.min(1, meanJerk / JERK_LIMIT))),
      sweeps: this.sweeps,
      peakRightDeg: Math.round(this.peakRight),
      peakLeftDeg: Math.round(this.peakLeft),
      signalDrops: this.drops,
      laneSpread: this.profile.laneSpread,
      pickupWindow: this.profile.pickupWindow
    };
  }
}

export function saveSession(summary: SessionSummary) {
  try {
    const log = JSON.parse(readStorage(LOG_KEY) ?? "[]") as SessionSummary[];
    writeStorage(LOG_KEY, JSON.stringify([...log, summary].slice(-50)));
  } catch { /* corrupt log: skip rather than block the finish screen */ }
}

export function loadSessions(): SessionSummary[] {
  try { return JSON.parse(readStorage(LOG_KEY) ?? "[]") as SessionSummary[]; } catch { return []; }
}
