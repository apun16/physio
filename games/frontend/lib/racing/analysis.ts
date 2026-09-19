import type { AnalysisRequest } from "../rehab/analysis";
import type { RehabProfile, SessionSummary } from "./rehab";
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
    history: history.slice(-5).map((s) => ({ level: s.level, ...sessionMetrics(s) }))
  };
}
