/**
 * Shared rehab analysis contract. Every game (hand-tracked or IMU) builds an
 * AnalysisRequest from its own session metrics and posts it to /api/analyze.
 * The server adds no game-specific logic: metrics are just named numbers, so
 * a new game only has to fill in `metrics`, `history` and (optionally) the
 * settings the model may tune.
 */

export type MetricValue = number | string;

/** A game setting the model may propose a new value for, inside hard limits set by the game/therapist. */
export interface Adjustable {
  current: number;
  min: number;
  max: number;
  /** largest change allowed in one step */
  maxStep: number;
}

export interface AnalysisRequest {
  /** game id, e.g. "pulse-circuit" */
  game: string;
  /** what drove the game: "hand-camera" | "imu" | ... */
  input: string;
  level: number;
  levelLabel: string;
  /** this session, computed on-device. Units go in the key, e.g. meanErrorPct. */
  metrics: Record<string, MetricValue>;
  /** previous sessions of this game, oldest first, same keys as `metrics` where possible */
  history: Record<string, MetricValue>[];
  /** settings the model may tune for the next session */
  adjustable?: Record<string, Adjustable>;
}

export interface AnalysisResult {
  headline: string;
  observations: string[];
  progress: string;
  nextStep: string;
  focus: "range" | "precision" | "smoothness" | "consistency" | "endurance";
  /** proposed next-session settings, already clamped to the allowed bounds */
  adjustments?: Record<string, number>;
  adjustmentReason?: string;
  provider: string;
  model: string;
  /** server-side latency, ms */
  ms: number;
  completionTokens?: number;
}

/** Clamp a proposal into [min, max] and to within maxStep of the current value. Missing/invalid values keep `current`. */
export function clampAdjustments(adjustable: Record<string, Adjustable>, proposed: Record<string, unknown>) {
  const out: Record<string, number> = {};
  for (const [key, a] of Object.entries(adjustable)) {
    const raw = Number(proposed[key]);
    const wanted = Number.isFinite(raw) ? raw : a.current;
    const stepped = Math.max(a.current - a.maxStep, Math.min(a.current + a.maxStep, wanted));
    out[key] = Math.round(Math.max(a.min, Math.min(a.max, stepped)) * 100) / 100;
  }
  return out;
}

/** Returns null on any failure so callers can keep showing the on-device stats. */
export async function requestAnalysis(body: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult | null> {
  try {
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    return response.ok ? ((await response.json()) as AnalysisResult) : null;
  } catch {
    return null;
  }
}
