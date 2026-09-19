"use client";

import { ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadSkywardAssets, type SkywardAssets } from "@/lib/skyward/assets";
import { DebugInputProvider } from "@/lib/skyward/input";
import { drawSkyward, HEIGHT, WIDTH } from "@/lib/skyward/render";
import { ENCOUNTERS } from "@/lib/skyward/encounters";
import { JourneyState } from "@/lib/skyward/state";

type Summary = { won: boolean; time: number; hp: number; maxHp: number; arrows: number; cleared: number; total: number };

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function SkywardGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let running = true;
    let last = performance.now();
    let assets: SkywardAssets | null = null;
    let state = new JourneyState();
    let summaryShown = false;
    let previousReset = resetRef.current;
    const input = new DebugInputProvider();
    input.attach(canvas);
    canvas.tabIndex = 0;
    canvas.focus();
    canvas.oncontextmenu = (event) => event.preventDefault();

    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r" && (state.phase === "dead" || state.phase === "complete")) {
        state = new JourneyState();
        setSummary(null);
      }
    };
    window.addEventListener("keydown", onKey);

    loadSkywardAssets()
      .then((loaded) => {
        if (!running) return;
        assets = loaded;
        setReady(true);
      })
      .catch((error: unknown) => {
        if (running) setFailed(error instanceof Error ? error.message : String(error));
      });

    const render = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (previousReset !== resetRef.current) {
        state = new JourneyState();
        previousReset = resetRef.current;
        setSummary(null);
      }
      if (assets) {
        state.apply(input.poll());
        state.update(dt);
        drawSkyward(context, state, assets, true);
        const over = state.phase === "complete" || state.phase === "dead";
        if (over && !summaryShown && state.endT > 0.35) {
          summaryShown = true;
          setSummary({ won: state.phase === "complete", time: state.elapsed, hp: state.hero.hp, maxHp: state.hero.maxHp, arrows: state.hero.arrows, cleared: state.cleared, total: ENCOUNTERS.length });
        } else if (!over) summaryShown = false;
      } else {
        context.fillStyle = "#070810";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.fillStyle = "#f8f5dc";
        context.font = '22px "Determination Mono", monospace';
        context.fillText("Loading the woods...", 80, 360);
      }
      animation = requestAnimationFrame(render);
    };
    let animation = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(animation);
      input.detach();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <main className="race-page skyward-page">
      <div className="race-crt" />
      <header className="race-header">
        <Link href="/dashboard"><ArrowLeft size={16} /> QUEST HUB</Link>
        <div><span>SKYWARD JOURNEY</span><b>WORLD 01</b></div>
        <div className="race-header-actions">
          <button onClick={() => { resetRef.current += 1; }} aria-label="Reset journey">
            <RotateCcw size={15} /><span>RESET</span>
          </button>
        </div>
      </header>
      <section className="race-shell">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} tabIndex={0} className={summary ? "dimmed" : undefined} aria-label="Skyward Journey side-view physiotherapy session" />
        {summary && (
          <div className="skyward-summary" data-won={summary.won}>
            <span className="summary-kicker">{summary.won ? "JOURNEY'S END" : "REST"}</span>
            <h1>{summary.won ? "Session complete" : "Session over"}</h1>
            <dl>
              <div><dt>Time</dt><dd>{formatTime(summary.time)}</dd></div>
              <div><dt>Enemies cleared</dt><dd>{summary.cleared}/{summary.total}</dd></div>
              <div><dt>Health left</dt><dd>{summary.hp}/{summary.maxHp}</dd></div>
              <div><dt>Arrows left</dt><dd>{summary.arrows}</dd></div>
            </dl>
            <div className="skyward-summary-actions">
              <button onClick={() => { resetRef.current += 1; }}><RotateCcw size={15} /> REPLAY</button>
              <Link href="/dashboard">QUEST HUB</Link>
            </div>
          </div>
        )}
        {failed && <p className="skyward-status">{failed}</p>}
        {!ready && !failed && <p className="skyward-status">Calibrating session...</p>}
      </section>
      <footer className="race-footer">
        <span><i className="key">J</i><i className="key">K</i><i className="key">L</i> SLASH</span>
        <span><i className="key">F</i> SHIELD</span>
        <span><i className="key">E</i> BOW</span>
        <b><i /> IMU SLOT OPEN — DEBUG INPUT ONLY</b>
      </footer>
    </main>
  );
}
