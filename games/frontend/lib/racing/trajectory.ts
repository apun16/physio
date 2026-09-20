/**
 * Trajectory capture and comparison for the racing game.
 *
 * The "optimal" path is the smooth curve through every coin lane: what a
 * patient with perfect control would trace.
 *
 * Two lines are recorded against course distance and scored against it:
 *  - the DRIVEN line: where the car actually went, steered by the IMU controller
 *  - the HAND line: where the camera saw the hand travel
 * The controller drives the car; the camera only watches, so the hand line is
 * an independent record of the movement being rehabilitated.
 */

import { ROAD_HALF_WIDTH } from "./rehab";

export interface TrajectorySample {
  /** course distance when sampled */
  d: number;
  /** race time, seconds */
  t: number;
  /** car lateral position, road units (+ = right) */
  x: number;
  /** raw palm position in mirrored image space, null when no hand was seen */
  hand: { x: number; y: number } | null;
  /** palm position mapped into road units the same way the car's x is, null when unseen */
  handX: number | null;
}

export interface CoinMark { d: number; lane: number; hit: boolean }

/** Scores for one traced line against the optimal curve. */
export interface PathScore {
  trace: { d: number; x: number }[];
  /** mean |line - optimal|, road units */
  meanError: number;
  maxError: number;
  /** mean signed (line - optimal): > 0 sits right of the ideal line */
  bias: number;
  /** mean error over the first / last third: end > start suggests fatigue */
  errorStart: number;
  errorEnd: number;
  /** 0..100, 100 = traced the optimal line exactly */
  score: number;
  /** total lateral travel vs the optimal line's. 1 = as efficient as optimal. */
  pathRatio: number;
}

export interface TrajectoryReport {
  totalDistance: number;
  actual: { d: number; x: number }[];
  optimal: { d: number; x: number }[];
  coins: CoinMark[];
  /** mean |actual - optimal|, road units */
  meanError: number;
  maxError: number;
  /** mean signed (actual - optimal), road units: > 0 drifts right of the ideal line */
  bias: number;
  /** mean error over the first / last third of the course: end > start suggests fatigue */
  errorStart: number;
  errorEnd: number;
  /** 0..100, 100 = traced the optimal line exactly */
  score: number;
  /** total lateral distance travelled by the car / by the optimal line. 1 = as efficient as optimal. */
  pathRatio: number;
  /** spread of the hand's vertical position as a share of frame height: wobble up/down while steering sideways */
  verticalDrift: number;
  /** share of samples where a hand was visible */
  handCoverage: number;
  /** the camera's read of the hand movement: the trajectory being evaluated */
  hand: PathScore | null;
}

const SAMPLE_EVERY = 0.05;
/** Lateral position error (road units) that maps to a score of 0. */
const ERROR_LIMIT = 0.6;
/** The car has this long (course distance) to line up with a coin before it is picked up or missed. */
const COIN_LEAD = 90;

export function coinLane(coinId: number, laneSpread: number) {
  return Math.sin(coinId * 2.2) * laneSpread;
}

/** Waypoints the optimal line passes through: the start, then every coin lane just before pickup. */
function waypoints(totalDistance: number, coinSpacing: number, laneSpread: number) {
  const points: { d: number; x: number }[] = [{ d: 0, x: 0 }];
  const count = Math.floor(totalDistance / coinSpacing);
  for (let id = 1; id <= count; id += 1) points.push({ d: id * coinSpacing - COIN_LEAD, x: coinLane(id, laneSpread) });
  points.push({ d: totalDistance, x: points[points.length - 1].x });
  return points;
}

/** Catmull-Rom through the waypoints: smooth, no jerk at the coins, passes through each one. */
export function optimalLine(totalDistance: number, coinSpacing: number, laneSpread: number) {
  const pts = waypoints(totalDistance, coinSpacing, laneSpread);
  return (d: number) => {
    let i = 0;
    while (i < pts.length - 2 && d > pts[i + 1].d) i += 1;
    const p0 = pts[Math.max(0, i - 1)].x, p1 = pts[i].x, p2 = pts[i + 1].x, p3 = pts[Math.min(pts.length - 1, i + 2)].x;
    const t = Math.max(0, Math.min(1, (d - pts[i].d) / (pts[i + 1].d - pts[i].d || 1)));
    const x = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    return Math.max(-ROAD_HALF_WIDTH, Math.min(ROAD_HALF_WIDTH, x));
  };
}

export class TrajectoryRecorder {
  private samples: TrajectorySample[] = [];
  private nextAt = 0;

  constructor(private laneSpread: number, private coinSpacing: number) {}

  update(dt: number, d: number, x: number, hand: { x: number; y: number } | null, handX: number | null = null) {
    this.nextAt -= dt;
    if (this.nextAt > 0) return;
    this.nextAt = SAMPLE_EVERY;
    const t = (this.samples.at(-1)?.t ?? 0) + (this.samples.length ? SAMPLE_EVERY : 0);
    this.samples.push({ d, t, x, hand, handX });
  }

  /** Score one traced line against the optimal curve. */
  private scoreLine(trace: { d: number; x: number }[], line: (d: number) => number): PathScore {
    const optimal = trace.map(({ d }) => line(d));
    let errorSum = 0, maxError = 0, actualTravel = 0, optimalTravel = 0;
    trace.forEach((point, i) => {
      const error = Math.abs(point.x - optimal[i]);
      errorSum += error;
      maxError = Math.max(maxError, error);
      if (i > 0) {
        actualTravel += Math.abs(point.x - trace[i - 1].x);
        optimalTravel += Math.abs(optimal[i] - optimal[i - 1]);
      }
    });
    const meanError = trace.length ? errorSum / trace.length : 0;
    const thirdMean = (from: number, to: number) => {
      const part = trace.slice(Math.floor(trace.length * from), Math.floor(trace.length * to));
      return part.length ? part.reduce((sum, p) => sum + Math.abs(p.x - line(p.d)), 0) / part.length : 0;
    };
    return {
      trace,
      meanError,
      maxError,
      bias: trace.length ? trace.reduce((sum, p, i) => sum + (p.x - optimal[i]), 0) / trace.length : 0,
      errorStart: thirdMean(0, 1 / 3),
      errorEnd: thirdMean(2 / 3, 1),
      score: Math.round(100 * (1 - Math.min(1, meanError / ERROR_LIMIT))),
      pathRatio: optimalTravel > 0 ? actualTravel / optimalTravel : 1
    };
  }

  report(totalDistance: number, collected: ReadonlySet<number>): TrajectoryReport {
    const line = optimalLine(totalDistance, this.coinSpacing, this.laneSpread);
    const actual = this.samples.map(({ d, x }) => ({ d, x }));
    const optimal = actual.map(({ d }) => ({ d, x: line(d) }));

    let errorSum = 0, maxError = 0, actualTravel = 0, optimalTravel = 0;
    actual.forEach((point, i) => {
      const error = Math.abs(point.x - optimal[i].x);
      errorSum += error;
      maxError = Math.max(maxError, error);
      if (i > 0) {
        actualTravel += Math.abs(point.x - actual[i - 1].x);
        optimalTravel += Math.abs(optimal[i].x - optimal[i - 1].x);
      }
    });
    const meanError = actual.length ? errorSum / actual.length : 0;
    const bias = actual.length ? actual.reduce((sum, p, i) => sum + (p.x - optimal[i].x), 0) / actual.length : 0;
    const thirdMean = (from: number, to: number) => {
      const part = actual.slice(Math.floor(actual.length * from), Math.floor(actual.length * to));
      return part.length ? part.reduce((sum, p) => sum + Math.abs(p.x - line(p.d)), 0) / part.length : 0;
    };

    const handTrace = this.samples
      .filter((s): s is TrajectorySample & { handX: number } => s.handX !== null)
      .map((s) => ({ d: s.d, x: s.handX }));
    const hand = handTrace.length > 1 ? this.scoreLine(handTrace, line) : null;

    const seen = this.samples.filter((s) => s.hand);
    const ys = seen.map((s) => s.hand!.y);
    const meanY = ys.reduce((a, b) => a + b, 0) / (ys.length || 1);
    const verticalDrift = ys.length ? Math.sqrt(ys.reduce((a, y) => a + (y - meanY) ** 2, 0) / ys.length) : 0;

    const coinCount = Math.floor(totalDistance / this.coinSpacing);
    const coins: CoinMark[] = Array.from({ length: coinCount }, (_, i) => ({
      d: (i + 1) * this.coinSpacing,
      lane: coinLane(i + 1, this.laneSpread),
      hit: collected.has(i + 1)
    }));

    return {
      totalDistance,
      actual,
      optimal,
      coins,
      meanError,
      maxError,
      bias,
      errorStart: thirdMean(0, 1 / 3),
      errorEnd: thirdMean(2 / 3, 1),
      score: Math.round(100 * (1 - Math.min(1, meanError / ERROR_LIMIT))),
      pathRatio: optimalTravel > 0 ? actualTravel / optimalTravel : 1,
      verticalDrift,
      handCoverage: this.samples.length ? seen.length / this.samples.length : 0,
      hand
    };
  }
}
