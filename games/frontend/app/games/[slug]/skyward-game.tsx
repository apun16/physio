"use client";

import { ArrowLeft, Bluetooth, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadSkywardAssets, type SkywardAssets } from "@/lib/skyward/assets";
import { DebugInputProvider, IMUInputProvider } from "@/lib/skyward/input";
import { SerialSensor } from "@/lib/racing/sensor";
import { drawSkyward, HEIGHT, WIDTH } from "@/lib/skyward/render";
import { ENCOUNTERS } from "@/lib/skyward/encounters";
import { JourneyState } from "@/lib/skyward/state";

type Summary = { won: boolean; time: number; hp: number; maxHp: number; arrows: number; cleared: number; total: number };

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function SkywardGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetRef = useRef(0);
  const [sensor] = useState(() => new SerialSensor());
  const sensorStatus = useSyncExternalStore(
    (notify) => sensor.subscribe(notify),
    () => sensor.status,
    () => "disconnected" as const
  );
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
    // Keyboard stays available for testing; the controller is layered on top and
    // polled last so its aim and shield state win when it is live.
    const input = new DebugInputProvider();
    const imu = new IMUInputProvider(sensor);
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
        state.apply([...input.poll(), ...imu.poll()]);
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
      void sensor.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [sensor]);

  const sensorConnected = sensorStatus === "connected";
  const [dismissedConnect, setDismissedConnect] = useState(false);
  const showConnect = !sensorConnected && !dismissedConnect && sensorStatus !== "unsupported";

  return (
    <main className="race-page skyward-page">
      <div className="race-crt" />
      <header className="race-header">
        <Link href="/dashboard"><ArrowLeft size={16} /> QUEST HUB</Link>
        <div><span>SKYWARD JOURNEY</span><b>WORLD 01</b></div>
        <div className="race-header-actions">
          {sensorStatus !== "unsupported" && (
            <button onClick={() => (sensorConnected ? sensor.disconnect() : sensor.connect())} aria-label={sensorConnected ? "Disconnect controller" : "Connect controller"}>
              <Bluetooth size={15} /><span>{sensorConnected ? "CONTROLLER ON" : sensorStatus === "connecting" ? "CONNECTING" : "CONNECT"}</span>
            </button>
          )}
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
        {showConnect && ready && !failed && (
          <div className="skyward-connect" role="dialog" aria-label="Connect your controller">
            <span>SKYWARD JOURNEY</span>
            <h1>Connect your controller</h1>
            <p>Squeeze and release to loose an arrow. Sweep your hand right to slash. Raise your arm to hold the shield.</p>
            <button className="go" onClick={() => void sensor.connect()}>
              <Play size={16} /> {sensorStatus === "connecting" ? "CONNECTING…" : "CONNECT CONTROLLER"}
            </button>
            <button className="skip" onClick={() => setDismissedConnect(true)}>PLAY WITH KEYBOARD</button>
            {sensor.error && <small>{sensor.error}</small>}
          </div>
        )}
        {failed && <p className="skyward-status">{failed}</p>}
        {!ready && !failed && <p className="skyward-status">Calibrating session...</p>}
      </section>
      <footer className="race-footer">
        <span>SQUEEZE &amp; RELEASE — BOW</span>
        <span>SWEEP RIGHT — SLASH</span>
        <span>RAISE PITCH — SHIELD</span>
        <b className={sensorConnected ? "" : "idle"}><i /> {sensorConnected ? "CONTROLLER LIVE" : sensorStatus === "unsupported" ? "USE CHROME OR EDGE" : "CONTROLLER NOT CONNECTED — J/K/L, F, E"}</b>
      </footer>
    </main>
  );
}
