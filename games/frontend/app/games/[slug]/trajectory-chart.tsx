"use client";

import { useEffect, useRef } from "react";
import { ROAD_HALF_WIDTH } from "../../../lib/racing/rehab";
import type { TrajectoryReport } from "../../../lib/racing/trajectory";

const W = 640;
const H = 220;
const PAD = 14;
const RANGE = 1.2; // lateral half-range shown, road units

/**
 * Lateral position over the course: the optimal line through every coin, the
 * line the controller actually drove, and — when the camera was watching — the
 * line the hand traced.
 */
export default function TrajectoryChart({ report }: { report: TrajectoryReport }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const px = (d: number) => PAD + (d / report.totalDistance) * (W - PAD * 2);
    const py = (x: number) => H / 2 - (x / RANGE) * (H / 2 - PAD);
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(PAD, py(ROAD_HALF_WIDTH), W - PAD * 2, py(-ROAD_HALF_WIDTH) - py(ROAD_HALF_WIDTH));
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD, py(0));
    ctx.lineTo(W - PAD, py(0));
    ctx.stroke();
    ctx.setLineDash([]);

    const trace = (points: { d: number; x: number }[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(px(p.d), py(p.x)) : ctx.moveTo(px(p.d), py(p.x))));
      ctx.stroke();
    };
    trace(report.optimal, "#5ef0ff", 3);
    trace(report.actual, "#ffd438", 2);
    if (report.hand) trace(report.hand.trace, "#ff6ad5", 2);

    for (const coin of report.coins) {
      ctx.beginPath();
      ctx.arc(px(coin.d), py(coin.lane), 4, 0, Math.PI * 2);
      if (coin.hit) { ctx.fillStyle = "#ffd438"; ctx.fill(); } else { ctx.strokeStyle = "#ef5444"; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }, [report]);

  return (
    <div className="trajectory-chart">
      <canvas ref={ref} width={W} height={H} role="img" aria-label={`Driven and hand paths against the optimal path. Driven line averages ${Math.round(report.meanError * 100)}% of the road half-width from optimal${report.hand ? `, hand line ${Math.round(report.hand.meanError * 100)}%` : ""}.`} />
      <div className="trajectory-legend">
        <span><i className="opt" /> OPTIMAL LINE</span>
        <span><i className="act" /> DRIVEN LINE</span>
        {report.hand && <span><i className="hand" /> HAND PATH</span>}
        <span><i className="coin" /> COIN HIT</span>
        <span><i className="miss" /> COIN MISSED</span>
      </div>
    </div>
  );
}
