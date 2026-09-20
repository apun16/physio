"use client";

import { ArrowLeft, Crosshair } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PaintballGame } from "@/lib/paintball/game";
import type { HudSnapshot } from "@/lib/paintball/types";
import "./paintball.css";

const emptyHud = (): HudSnapshot => ({
  phase: "boot",
  health: 5,
  maxHealth: 5,
  score: 0,
  wave: 1,
  combo: 1,
  accuracy: 1,
  hits: 0,
  misses: 0,
  defeats: 0,
  coverage: 0,
  survival: 0,
  longestCombo: 1,
  toast: "",
  shootState: "READY",
  aiming: false,
  imu: "off",
  mode: "kbm",
  dodge: "CENTER",
  count: 0,
  hitFlash: 0,
  dodgeFlash: 0,
  debug: { pitch: 0, yaw: 0, roll: 0, squeeze: 0, connected: false, noise: false, aim: { x: 0, y: 0 } }
});

export default function PaintballGameView() {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PaintballGame | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(emptyHud);
  const [screen, setScreen] = useState<"start" | "play">("start");

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;
    const game = new PaintballGame(canvas, shell);
    gameRef.current = game;
    let last = performance.now();
    let live = true;
    let raf = 0;
    let hudWait = 0;
    const tick = (now: number) => {
      if (!live) return;
      const raw = Math.min(0.35, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        game.update(raw);
      } catch (error) {
        console.error(error);
      }
      hudWait += raw;
      const snap = game.snapshot();
      if (hudWait >= 0.08 || snap.phase === "countdown" || snap.toast || snap.phase === "over" || snap.phase === "pause") {
        hudWait = 0;
        setHud(snap);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => game.resize();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") game.togglePause();
      if (event.key.toLowerCase() === "r" && game.phase === "over") game.restart();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const begin = () => {
    setScreen("play");
    gameRef.current?.setMode("kbm");
    gameRef.current?.startPlay();
  };

  return (
    <main className="paint-page" ref={shellRef}>
      <header className="paint-top">
        <Link href="/dashboard"><ArrowLeft size={16} /> QUEST HUB</Link>
        <div><span>INKBURST</span><b>WORLD 03</b></div>
        <div className="paint-top-actions">
          <button type="button" onClick={() => gameRef.current?.togglePause()}>PAUSE</button>
        </div>
      </header>

      <section className="paint-stage">
        <canvas ref={canvasRef} className="paint-canvas" />
        <div className="paint-cross" aria-hidden="true"><i /><i /><b /></div>
        {hud.phase === "play" && (
          <div className="paint-hud">
            <div className="paint-hearts">{Array.from({ length: hud.maxHealth }, (_, index) => <span key={index} data-on={index < hud.health} />)}</div>
            <div className="paint-meta">
              <strong>{hud.score.toString().padStart(6, "0")}</strong>
              <span>WAVE {hud.wave}</span>
              <span>x{hud.combo.toFixed(1)}</span>
              <span>{Math.round(hud.accuracy * 100)}%</span>
              <span>{Math.round(hud.coverage * 100)}% INK</span>
            </div>
          </div>
        )}
        {hud.toast && <div className="paint-toast" data-kind={hud.toast.includes("DODGE") ? "dodge" : hud.toast === "PAINTED" ? "hurt" : "ok"}>{hud.toast}</div>}
        <div className="paint-flash" style={{ opacity: hud.hitFlash * 0.65 }} />
        {hud.phase === "countdown" && <div className="paint-count">{Math.max(1, Math.ceil(hud.count))}</div>}
        {hud.phase === "pause" && (
          <div className="paint-card paint-pause">
            <span>PAUSED</span>
            <h1>Street frozen</h1>
            <div className="paint-actions">
              <button type="button" className="go" onClick={() => gameRef.current?.togglePause()}>RESUME</button>
            </div>
          </div>
        )}
        {hud.phase === "over" && (
          <div className="paint-card">
            <span>RANGE CLOSED</span>
            <h1>{hud.score} PTS</h1>
            <p>Wave {hud.wave} · {hud.defeats} splatters · {Math.round(hud.accuracy * 100)}% accuracy · {Math.round(hud.coverage * 100)}% coverage · combo x{hud.longestCombo.toFixed(1)} · {Math.round(hud.survival)}s</p>
            <div className="paint-actions">
              <button type="button" className="go" onClick={() => gameRef.current?.restart()}>R / RESTART</button>
              <Link href="/dashboard">RETURN</Link>
            </div>
          </div>
        )}
        {screen === "start" && (
          <div className="paint-card paint-start">
            <span>REPLAY // WORLD 03</span>
            <h1>INKBURST</h1>
            <p>First-person paintball down a city street. Squeeze, aim, splat.</p>
            <ul className="paint-keys">
              <li><b>ARROWS</b><small>MOVE</small></li>
              <li><b>MOUSE</b><small>AIM</small></li>
              <li><b>CLICK</b><small>SHOOT</small></li>
              <li><b>ESC</b><small>PAUSE</small></li>
            </ul>
            <div className="paint-actions">
              <button type="button" className="go" onClick={begin}>START MATCH</button>
            </div>
          </div>
        )}
      </section>
      <footer className="paint-foot">
        <Crosshair size={14} />
        <span>ARROWS MOVE</span>
        <span>MOUSE AIM</span>
        <span>CLICK SHOOT</span>
      </footer>
    </main>
  );
}
