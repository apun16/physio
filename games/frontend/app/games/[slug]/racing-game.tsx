"use client";

import { ArrowLeft, Bluetooth, Gauge, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LEVELS, RehabRecorder, ROAD_HALF_WIDTH, loadProfile, recommend, saveLevel, saveSession, type RehabProfile, type SessionSummary } from "../../../lib/racing/rehab";
import { SerialSensor } from "../../../lib/racing/sensor";

const COIN_SPACING = 520;

type RaceSnapshot = {
  speed: number;
  coins: number;
  lap: number;
  progress: number;
  time: string;
  finished: boolean;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  const millis = Math.floor((seconds % 1) * 1000).toString().padStart(3, "0");
  return `${minutes}:${rest}.${millis}`;
}

export default function RacingGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const resetRef = useRef(0);
  const [sensor] = useState(() => new SerialSensor());
  const sensorStatus = useSyncExternalStore(
    (notify) => sensor.subscribe(notify),
    () => sensor.status,
    () => "disconnected" as const
  );
  const profileRef = useRef<RehabProfile>(LEVELS[0]);
  const [profile, setProfile] = useState<RehabProfile>(LEVELS[0]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [signalLost, setSignalLost] = useState(false);
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<RaceSnapshot>({ speed: 0, coins: 0, lap: 1, progress: 0, time: "00:00.000", finished: false });

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    const saved = loadProfile();
    profileRef.current = saved;
    setProfile(saved);
    return () => { void sensor.disconnect(); };
  }, [sensor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const keys = new Set<string>();
    let frame = 0;
    let last = performance.now();
    let x = 0;
    let speed = 0;
    let distance = 0;
    let elapsed = 0;
    let coins = 0;
    let lap = 1;
    let pickupFlash = 0;
    let finished = false;
    let recorder: RehabRecorder | null = null;
    let wasLive = false;
    let previousReset = resetRef.current;
    const collectedCoins = new Set<number>();

    const press = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "a", "d", "A", "D", " "].includes(event.key)) event.preventDefault();
      keys.add(event.key.toLowerCase());
      if (event.key === " " && !finished) setRunning((value) => !value);
    };
    const release = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    window.addEventListener("keydown", press);
    window.addEventListener("keyup", release);

    const pixelRect = (px: number, py: number, width: number, height: number, color: string) => {
      context.fillStyle = color;
      context.fillRect(Math.round(px), Math.round(py), Math.round(width), Math.round(height));
    };

    const drawCloud = (cx: number, cy: number, scale: number) => {
      pixelRect(cx, cy + 10 * scale, 72 * scale, 18 * scale, "#fff9de");
      pixelRect(cx + 14 * scale, cy, 38 * scale, 18 * scale, "#fff9de");
    };

    const drawTree = (tx: number, ty: number, scale: number) => {
      pixelRect(tx + 10 * scale, ty + 25 * scale, 8 * scale, 25 * scale, "#5e3828");
      pixelRect(tx, ty + 11 * scale, 28 * scale, 23 * scale, "#146c42");
      pixelRect(tx + 5 * scale, ty, 18 * scale, 18 * scale, "#29a851");
    };

    const drawItemBox = (boxX: number, boxY: number, size: number) => {
      pixelRect(boxX + 7, boxY + 9, size, size, "#101522");
      pixelRect(boxX, boxY, size, size, "#fff2b1");
      pixelRect(boxX + 4, boxY + 4, size - 8, size - 8, "#ef4052");
      pixelRect(boxX + 8, boxY + 8, size - 16, size - 16, "#152033");
      context.fillStyle = "#fff8dc";
      context.font = `bold ${Math.round(size * .55)}px monospace`;
      context.textAlign = "center";
      context.fillText("?", boxX + size / 2, boxY + size * .72);
    };

    const drawCoin = (cx: number, cy: number, scale: number) => {
      context.fillStyle = "#ffcf35";
      context.beginPath();
      context.ellipse(cx, cy, 7 * scale, 11 * scale, 0, 0, Math.PI * 2);
      context.fill();
      pixelRect(cx - scale, cy - 7 * scale, 2 * scale, 14 * scale, "#fff29a");
    };

    const render = (now: number) => {
      const dt = Math.min((now - last) / 1000, .04);
      last = now;
      const width = canvas.width;
      const height = canvas.height;

      if (previousReset !== resetRef.current) {
        x = 0;
        speed = 0;
        distance = 0;
        elapsed = 0;
        coins = 0;
        lap = 1;
        finished = false;
        recorder = null;
        collectedCoins.clear();
        previousReset = resetRef.current;
      }

      const rehab = profileRef.current;
      const usingSensor = sensor.status === "connected";
      const sensorLive = sensor.isLive(now);
      if (usingSensor && !sensorLive && wasLive && runningRef.current) {
        // Safe loss-of-signal: stop the car rather than let it drift with a stale reading.
        recorder?.signalDropped();
        runningRef.current = false;
        setRunning(false);
        setSignalLost(true);
      }
      wasLive = sensorLive;

      if (runningRef.current) {
        const offRoad = Math.abs(x) > ROAD_HALF_WIDTH;
        const targetSpeed = offRoad ? 118 : 245;
        speed += (targetSpeed - speed) * Math.min(1, dt * (offRoad ? 4.5 : 2.2));
        recorder ??= new RehabRecorder(rehab, usingSensor ? "sensor" : "keyboard");
        const frame = sensor.latest;
        if (usingSensor) {
          // Wrist angle maps straight to lateral position: reaching a lane needs that share of the calibrated range.
          // Without a fresh reading the car holds its line instead of following stale data.
          if (frame && sensorLive) x += (frame.steer - x) * Math.min(1, dt * 8);
        } else {
          const steering = Number(keys.has("arrowright") || keys.has("d")) - Number(keys.has("arrowleft") || keys.has("a"));
          x += steering * dt * (1.15 + speed / 360);
          x *= 1 - dt * .15;
        }
        x = Math.max(-1.35, Math.min(1.35, x));
        recorder.update(dt, x, frame && usingSensor ? frame.steer : x, frame && usingSensor ? frame.roll : null);
        distance += speed * dt;
        elapsed += dt;
        pickupFlash = Math.max(0, pickupFlash - dt);
        if (distance >= 5000 * lap) lap = Math.min(3, lap + 1);
        if (distance >= 15000) {
          distance = 15000;
          speed = 0;
          finished = true;
          runningRef.current = false;
          setRunning(false);
          const result = (recorder ?? new RehabRecorder(rehab, "keyboard")).summarize(coins, distance, COIN_SPACING);
          saveSession(result);
          setSummary(result);
        }
      }

      const sky = context.createLinearGradient(0, 0, 0, height * .48);
      sky.addColorStop(0, "#67c8f0");
      sky.addColorStop(1, "#ffe47d");
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      pixelRect(0, height * .43, width, height * .57, "#38b94d");
      for (let stripe = 0; stripe < 18; stripe += 1) {
        pixelRect(0, height * .43 + stripe * 24, width, 8, stripe % 2 ? "rgba(54,205,46,.55)" : "rgba(31,173,49,.35)");
      }

      context.fillStyle = "#fff2a7";
      context.beginPath();
      context.arc(width * .11, height * .13, 43, 0, Math.PI * 2);
      context.fill();
      drawCloud(width * .25, height * .11, 1.1);
      drawCloud(width * .66, height * .16, .75);
      drawCloud(width * .84, height * .08, 1.25);

      const horizon = height * .43;
      context.fillStyle = "#21aa36";
      context.beginPath();
      context.arc(width * .07, horizon + 25, 120, Math.PI, Math.PI * 2);
      context.arc(width * .76, horizon + 28, 92, Math.PI, Math.PI * 2);
      context.arc(width * .92, horizon + 18, 142, Math.PI, Math.PI * 2);
      context.fill();
      context.fillStyle = "#45ca31";
      context.beginPath();
      context.arc(width * .24, horizon + 24, 76, Math.PI, Math.PI * 2);
      context.arc(width * .66, horizon + 25, 68, Math.PI, Math.PI * 2);
      context.fill();
      drawTree(width * .04, horizon - 75, 1.25);
      drawTree(width * .22, horizon - 88, 1.4);
      drawTree(width * .71, horizon - 76, 1.3);
      drawTree(width * .94, horizon - 96, 1.5);
      pixelRect(width * .16, horizon - 47, 45, 47, "#ef414b");
      pixelRect(width * .158, horizon - 52, 49, 10, "#fff8dc");
      pixelRect(width * .83, horizon - 47, 45, 47, "#326bd7");
      pixelRect(width * .828, horizon - 52, 49, 10, "#fff8dc");

      const curve = Math.sin(distance / 720) * width * .11;
      const roadTop = width * .09;
      const roadBottom = width * .72;
      context.fillStyle = "#e5cf45";
      context.beginPath();
      context.moveTo(width / 2 + curve - roadTop / 2 - 12, horizon);
      context.lineTo(width / 2 + curve + roadTop / 2 + 12, horizon);
      context.lineTo(width / 2 + roadBottom / 2 + 28, height);
      context.lineTo(width / 2 - roadBottom / 2 - 28, height);
      context.fill();
      context.fillStyle = "#5b6070";
      context.beginPath();
      context.moveTo(width / 2 + curve - roadTop / 2, horizon);
      context.lineTo(width / 2 + curve + roadTop / 2, horizon);
      context.lineTo(width / 2 + roadBottom / 2, height);
      context.lineTo(width / 2 - roadBottom / 2, height);
      context.fill();

      for (let index = 0; index < 12; index += 1) {
        const phase = ((index / 12 + (distance % 310) / 310) % 1);
        const depth = phase * phase;
        const markerY = horizon + depth * (height - horizon);
        const markerWidth = 3 + depth * 12;
        const center = width / 2 + curve * (1 - phase);
        pixelRect(center - markerWidth / 2, markerY, markerWidth, 6 + depth * 24, "#fffbd2");
      }

      const blockColors = ["#ef453f", "#2c6fd5", "#28a94f", "#f2b82f", "#f3f0d7"];
      for (let index = 0; index < 17; index += 1) {
        const phase = ((index / 17 + (distance % 280) / 280) % 1);
        const depth = phase * phase;
        const blockY = horizon + depth * (height - horizon) - 9;
        const spread = roadTop / 2 + (roadBottom / 2 - roadTop / 2) * depth;
        const center = width / 2 + curve * (1 - phase);
        const size = 5 + depth * 27;
        const color = blockColors[index % blockColors.length];
        pixelRect(center - spread - size * 1.7 + 4, blockY + 4, size * 1.45, size, "#1b4731");
        pixelRect(center - spread - size * 1.7, blockY, size * 1.45, size, color);
        pixelRect(center + spread + size * .25 + 4, blockY + 4, size * 1.45, size, "#1b4731");
        pixelRect(center + spread + size * .25, blockY, size * 1.45, size, blockColors[(index + 2) % blockColors.length]);
      }

      const firstCoin = Math.floor(distance / COIN_SPACING);
      for (let index = 1; index <= 7; index += 1) {
        const coinId = firstCoin + index;
        const coinDistance = coinId * COIN_SPACING - distance;
        if (coinDistance <= 0 || coinDistance > 2600 || collectedCoins.has(coinId)) continue;
        const phase = 1 - coinDistance / 2600;
        const depth = phase * phase;
        const lane = Math.sin(coinId * 2.2) * rehab.laneSpread;
        const center = width / 2 + curve * (1 - phase);
        const spread = roadTop / 2 + (roadBottom / 2 - roadTop / 2) * depth;
        drawCoin(center + lane * spread, horizon + depth * (height - horizon) - 25, .45 + depth * 1.2);
        if (runningRef.current && coinDistance < 175 && Math.abs(x - lane) < rehab.pickupWindow) {
          collectedCoins.add(coinId);
          coins += 1;
          pickupFlash = .45;
        }
      }

      const carX = width / 2 + x * roadBottom * .31;
      const carY = height * .76;
      const bounce = runningRef.current ? Math.sin(now / 70) * 2 : 0;
      context.fillStyle = "rgba(20,28,38,.35)";
      context.beginPath();
      context.ellipse(carX, carY + 104, 100, 24, 0, 0, Math.PI * 2);
      context.fill();
      pixelRect(carX - 78, carY + 45 + bounce, 156, 54, "#ef382f");
      pixelRect(carX - 63, carY + 32 + bounce, 126, 42, "#fa4639");
      pixelRect(carX - 70, carY + 94 + bounce, 25, 22, "#141923");
      pixelRect(carX + 45, carY + 94 + bounce, 25, 22, "#141923");
      pixelRect(carX - 48, carY + 57 + bounce, 96, 15, "#292f3b");
      pixelRect(carX - 12, carY + 54 + bounce, 24, 21, "#fff7dc");
      pixelRect(carX - 50, carY + 37 + bounce, 15, 10, "#ffd53f");
      pixelRect(carX + 35, carY + 37 + bounce, 15, 10, "#ffd53f");
      pixelRect(carX - 55, carY + 26 + bounce, 110, 9, "#d82d2b");
      pixelRect(carX - 45, carY - 5 + bounce, 90, 55, "#172030");
      pixelRect(carX - 32, carY - 25 + bounce, 64, 50, "#2460cf");
      pixelRect(carX - 28, carY - 34 + bounce, 56, 34, "#e93a32");
      pixelRect(carX - 38, carY - 64 + bounce, 76, 40, "#f0b274");
      pixelRect(carX - 43, carY - 82 + bounce, 86, 26, "#e51e27");
      pixelRect(carX - 31, carY - 89 + bounce, 55, 15, "#ed2931");
      pixelRect(carX - 27, carY - 47 + bounce, 54, 15, "#71331f");
      pixelRect(carX - 44, carY - 4 + bounce, 18, 18, "#ffd345");
      pixelRect(carX + 26, carY - 4 + bounce, 18, 18, "#ffd345");

      drawItemBox(34, 31, 65);
      drawItemBox(72, 69, 85);
      context.strokeStyle = "rgba(239,247,221,.8)";
      context.lineWidth = 5;
      context.beginPath();
      context.ellipse(width - 133, height * .43, 80, 48, 0, 0, Math.PI * 2);
      context.stroke();
      const steerAngle = x * 1.55;
      context.fillStyle = "#ef5444";
      context.beginPath();
      context.arc(width - 133 + Math.cos(steerAngle) * 80, height * .43 + Math.sin(steerAngle) * 48, 8, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#fff7de";
      context.lineWidth = 3;
      context.stroke();

      context.textAlign = "left";
      context.font = "bold 31px monospace";
      context.fillStyle = "#fff9df";
      context.strokeStyle = "#1c2432";
      context.lineWidth = 7;
      context.strokeText(`◉ ${coins.toString().padStart(2, "0")}`, 34, height - 82);
      context.fillText(`◉ ${coins.toString().padStart(2, "0")}`, 34, height - 82);
      context.strokeText(`⚑ ${lap}/3`, 34, height - 39);
      context.fillText(`⚑ ${lap}/3`, 34, height - 39);
      context.textAlign = "right";
      context.font = "bold 92px monospace";
      context.fillStyle = "#ffd438";
      context.strokeStyle = "#fff9df";
      context.lineWidth = 10;
      context.strokeText("1", width - 74, height - 62);
      context.fillText("1", width - 74, height - 62);
      context.font = "bold 30px monospace";
      context.fillStyle = "#fff9df";
      context.strokeStyle = "#192131";
      context.lineWidth = 7;
      context.strokeText("ST", width - 33, height - 35);
      context.fillText("ST", width - 33, height - 35);

      if (pickupFlash > 0) {
        context.fillStyle = `rgba(255, 221, 67, ${pickupFlash})`;
        context.fillRect(0, 0, width, height);
        context.font = "bold 30px monospace";
        context.fillStyle = "#fff8b6";
        context.textAlign = "center";
        context.fillText("COIN +1", width / 2, height * .28);
      }

      if (!runningRef.current && !finished) {
        context.fillStyle = "rgba(5,7,15,.3)";
        context.fillRect(0, 0, width, height);
      }

      frame += 1;
      if (frame % 8 === 0) setSnapshot({ speed: Math.round(speed), coins, lap, progress: Math.min(100, distance / 150), time: formatTime(elapsed), finished });
      animation = requestAnimationFrame(render);
    };

    let animation = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("keydown", press);
      window.removeEventListener("keyup", release);
    };
  }, [sensor]);

  const reset = () => {
    resetRef.current += 1;
    setSummary(null);
    setSignalLost(false);
    setSnapshot({ speed: 0, coins: 0, lap: 1, progress: 0, time: "00:00.000", finished: false });
    setRunning(false);
  };

  const startRace = () => {
    setSignalLost(false);
    setRunning(true);
  };

  const changeLevel = (level: number) => {
    saveLevel(level);
    profileRef.current = LEVELS[level - 1];
    setProfile(LEVELS[level - 1]);
    reset();
  };

  const next = summary ? recommend(summary, profile) : null;
  const sensorConnected = sensorStatus === "connected";

  return (
    <main className="race-page">
      <div className="race-crt" />
      <header className="race-header">
        <Link href="/dashboard"><ArrowLeft size={16} /> QUEST HUB</Link>
        <div><span>PULSE CIRCUIT</span><b>WORLD 02</b></div>
        <div className="race-header-actions">{sensorStatus !== "unsupported" && <button onClick={() => (sensorConnected ? sensor.disconnect() : sensor.connect())} aria-label={sensorConnected ? "Disconnect sensor" : "Connect sensor"}><Bluetooth size={15} /><span>{sensorConnected ? "SENSOR ON" : sensorStatus === "connecting" ? "CONNECTING" : "CONNECT"}</span></button>}<button onClick={snapshot.finished ? reset : () => (running ? setRunning(false) : startRace())}>{snapshot.finished ? <RotateCcw size={15} /> : running ? <Pause size={15} /> : <Play size={15} />}<span>{snapshot.finished ? "REPLAY" : running ? "PAUSE" : "START"}</span></button><button onClick={reset} aria-label="Reset race"><RotateCcw size={15} /></button><button aria-label="Sound"><Volume2 size={15} /></button></div>
      </header>

      <section className="race-shell">
        <div className="race-command-frame" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="race-side-readout input-readout">
          <span>INPUT VECTOR</span><b>{running ? "LIVE" : "STANDBY"}</b><small>IMU // MANUAL</small>
        </div>
        <div className="race-side-readout sync-readout">
          <span>COURSE SYNC</span><b>{Math.max(1, Math.round(snapshot.progress)).toString().padStart(2, "0")}%</b><small>LINE // 02</small>
        </div>
        <div className="race-hud top-left"><span>LAP</span><strong>{snapshot.lap}<small>/3</small></strong></div>
        <div className="race-hud top-center"><span>TIME TRIAL</span><strong>{snapshot.time}</strong></div>
        <div className="race-hud top-right"><span>COINS</span><strong>◉ {snapshot.coins.toString().padStart(2, "0")}</strong></div>
        <canvas ref={canvasRef} width={1280} height={720} aria-label="Playable Pulse Circuit kart racing game" />
        <div className="speed-hud"><Gauge size={18} /><strong>{snapshot.speed}</strong><span>KM/H</span></div>
        <div className="race-progress"><span style={{ width: `${snapshot.progress}%` }} /></div>
        {sensorConnected && !snapshot.finished && (
          <div className="sensor-panel">
            <span>LEVEL {profile.level} · {profile.label.toUpperCase()}</span>
            <div className="sensor-steps">
              <button onClick={() => sensor.send("center")}>1 · HOLD NEUTRAL, SET CENTER</button>
              <button onClick={() => sensor.send("rollRight")}>2 · TURN RIGHT, SAVE LIMIT</button>
              <button onClick={() => sensor.send("rollLeft")}>3 · TURN LEFT, SAVE LIMIT</button>
            </div>
            <small>Rotate your forearm to steer. Limits are saved to your comfortable range.</small>
          </div>
        )}
        {!running && !snapshot.finished && <button className="race-start" onClick={startRace}><Play size={21} fill="currentColor" /><span>{signalLost ? "SENSOR LOST" : snapshot.time === "00:00.000" ? "START RACE" : "RESUME"}</span><small>{signalLost ? "RECONNECT OR CHECK THE DEVICE, THEN RESUME" : sensorConnected ? "ROTATE YOUR FOREARM TO STEER" : "ARROW KEYS / A + D TO STEER"}</small></button>}
        {snapshot.finished && (
          <div className="finish-screen" role="dialog" aria-label="Race complete">
            <div className="finish-burst" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
            <span className="finish-kicker">COURSE COMPLETE</span>
            <div className="finish-stars"><i>★</i><i>★</i><i>★</i></div>
            <h1>YOU DID IT!</h1>
            <p>Three laps complete. Your steering quest is officially cleared.</p>
            <div className="finish-stats">
              <div><span>FINAL TIME</span><strong>{snapshot.time}</strong></div>
              <div><span>COINS</span><strong>◉ {snapshot.coins}</strong></div>
              <div><span>QUEST XP</span><strong>+{750 + snapshot.coins * 25}</strong></div>
            </div>
            {summary && next && (
              <div className="finish-rehab">
                <div>
                  {summary.source === "sensor" && <span>REACH <b>R {summary.peakRightDeg}° · L {summary.peakLeftDeg}°</b></span>}
                  <span>SWEEPS <b>{summary.sweeps}</b></span>
                  <span>COINS <b>{summary.coins}/{summary.coinsOffered}</b></span>
                  <span>SMOOTH <b>{summary.smoothness}</b></span>
                  <span>ON ROAD <b>{Math.round(summary.onRoad * 100)}%</b></span>
                </div>
                <p>NEXT STEP: {next.reason}</p>
                {next.action !== "repeat" && <button onClick={() => changeLevel(profile.level + (next.action === "advance" ? 1 : -1))}>{next.action === "advance" ? `TRY LEVEL ${profile.level + 1}` : `DROP TO LEVEL ${profile.level - 1}`}</button>}
              </div>
            )}
            <div className="finish-actions">
              <button onClick={reset}><RotateCcw size={15} /> RACE AGAIN</button>
              <Link href="/dashboard">QUEST HUB <ArrowLeft size={15} /></Link>
            </div>
            <small>NEW BEST TIMES ARE SAVED TO YOUR TRAINING LOG</small>
          </div>
        )}
      </section>

      <footer className="race-footer"><span><i className="key">A</i><i className="key">D</i> STEER</span><span><i className="key wide">SPACE</i> PAUSE</span><b className={sensorConnected ? "" : "idle"}><i /> {sensorConnected ? "SENSOR LIVE" : sensorStatus === "unsupported" ? "KEYBOARD ONLY (USE CHROME FOR SENSOR)" : "KEYBOARD MODE"}</b></footer>
    </main>
  );
}
