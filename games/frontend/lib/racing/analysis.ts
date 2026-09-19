import type { AnalysisRequest, AnalysisResult } from "../rehab/analysis";
import { clampAdjustments } from "../rehab/analysis";
import { TUNING_BOUNDS, type RehabProfile, type SessionSummary, type Tuning } from "./rehab";
import type { TrajectoryReport } from "./trajectory";

const pct = (value: number) => Math.round(value * 100);

/** Session-level keys shared by this session and its history rows. */
function sessionMetrics(s: SessionSummary): Record<string, number> {
  return {
    coinsHit: s.coins,
    coinsOffered: s.coinsOffered,
    accuracyPct: pct(s.accuracy),
    onRoadPct: pct(s.onRoad),
    smoothness0to100: s.smoothness,
    sweeps: s.sweeps,
    durationSec: Math.round(s.durationSec),
    signalDrops: s.signalDrops,
    ...(s.laneSpread !== undefined ? { laneSpread: s.laneSpread, pickupWindow: s.pickupWindow ?? 0 } : {}),
    ...(s.pathScore !== undefined ? { pathMatch0to100: s.pathScore } : {})
  };
}

export function buildRacingAnalysis(summary: SessionSummary, profile: RehabProfile, path: TrajectoryReport | null, history: SessionSummary[]): AnalysisRequest {
  const tracked = path !== null && path.handCoverage > 0;
  return {
    game: "pulse-circuit",
    input: tracked ? "hand-camera" : "imu",
    level: profile.level,
    levelLabel: profile.label,
    metrics: {
      ...sessionMetrics(summary),
      ...(tracked
        ? {
            meanErrorFromOptimalPct: pct(path.meanError),
            worstErrorFromOptimalPct: pct(path.maxError),
            bias: Math.round(path.bias * 100) / 100,
            errorStartPct: pct(path.errorStart),
            errorEndPct: pct(path.errorEnd),
            pathLengthVsOptimal: Math.round(path.pathRatio * 10) / 10,
            verticalWobblePct: pct(path.verticalDrift),
            handVisiblePct: pct(path.handCoverage)
          }
        : { peakRightDeg: summary.peakRightDeg, peakLeftDeg: summary.peakLeftDeg })
    },
    history: history.slice(-5).map((s) => ({ level: s.level, ...sessionMetrics(s) })),
    adjustable: {
      laneSpread: { current: profile.laneSpread, ...TUNING_BOUNDS.laneSpread },
      pickupWindow: { current: profile.pickupWindow, ...TUNING_BOUNDS.pickupWindow }
    }
  };
}

export interface TuningProposal { tuning: Tuning; laneDelta: number; windowDelta: number; reason: string }

/**
 * Turn the model's proposal into something safe to apply. The server already clamps, but the client
 * re-checks (never trust the wire) and adds one rule the model can't override: if the session went badly,
 * never make it harder.
 */
export function proposeTuning(result: AnalysisResult, summary: SessionSummary, profile: RehabProfile): TuningProposal | null {
  if (!result.adjustments) return null;
  const safe = clampAdjustments(
    { laneSpread: { current: profile.laneSpread, ...TUNING_BOUNDS.laneSpread }, pickupWindow: { current: profile.pickupWindow, ...TUNING_BOUNDS.pickupWindow } },
    result.adjustments
  );
  const struggled = summary.accuracy < 0.4 || summary.signalDrops >= 2;
  // Harder = wider lanes (more reach) and a smaller pickup window (more precision).
  const laneSpread = struggled ? Math.min(safe.laneSpread, profile.laneSpread) : safe.laneSpread;
  const pickupWindow = struggled ? Math.max(safe.pickupWindow, profile.pickupWindow) : safe.pickupWindow;
  const laneDelta = Math.round((laneSpread - profile.laneSpread) * 100) / 100;
  const windowDelta = Math.round((pickupWindow - profile.pickupWindow) * 100) / 100;
  if (laneDelta === 0 && windowDelta === 0) return null;
  return { tuning: { level: profile.level, laneSpread, pickupWindow }, laneDelta, windowDelta, reason: result.adjustmentReason ?? "" };
}
