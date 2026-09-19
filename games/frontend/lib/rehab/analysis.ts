/**
 * Shared rehab analysis contract. Every game (hand-tracked or IMU) builds an
 * AnalysisRequest from its own session metrics and posts it to /api/analyze.
 * The server adds no game-specific logic: metrics are just named numbers, so
 * a new game only has to fill in `metrics` and `history`.
 */

export type MetricValue = number | string;

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
}

export interface AnalysisResult {
  headline: string;
  observations: string[];
  progress: string;
  nextStep: string;
  focus: "range" | "precision" | "smoothness" | "consistency" | "endurance";
  /** server-side latency, ms */
  ms: number;
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
