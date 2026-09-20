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
  // The controller always steers; the camera is an optional observer, so the
  // driven line is always reported and the hand line only when it was tracked.
  const hand = path?.hand ?? null;
  return {
    game: "pulse-circuit",
    input: hand ? "imu-steered-hand-tracked" : "imu",
    level: profile.level,
    levelLabel: profile.label,
    metrics: {
      ...sessionMetrics(summary),
      peakRightDeg: summary.peakRightDeg,
      peakLeftDeg: summary.peakLeftDeg,
      ...(path
        ? {
            drivenMeanErrorFromOptimalPct: pct(path.meanError),
            drivenWorstErrorFromOptimalPct: pct(path.maxError),
            drivenBias: Math.round(path.bias * 100) / 100,
            drivenErrorStartPct: pct(path.errorStart),
            drivenErrorEndPct: pct(path.errorEnd),
            drivenPathLengthVsOptimal: Math.round(path.pathRatio * 10) / 10
          }
        : {}),
      ...(hand
        ? {
            handMatch0to100: hand.score,
            handMeanErrorFromOptimalPct: pct(hand.meanError),
            handWorstErrorFromOptimalPct: pct(hand.maxError),
            handBias: Math.round(hand.bias * 100) / 100,
            handErrorStartPct: pct(hand.errorStart),
            handErrorEndPct: pct(hand.errorEnd),
            handPathLengthVsOptimal: Math.round(hand.pathRatio * 10) / 10,
            handVerticalWobblePct: pct(path!.verticalDrift),
            handVisiblePct: pct(path!.handCoverage)
          }
        : {})
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
