"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pause, Play, RefreshCw, ShieldAlert, Usb } from "lucide-react";
import CameraCalibration, { type CalibrationRange, type MovementFrame } from "./camera-calibration";
import { extractExercisePlan, generateGameSpec } from "../../../lib/therapy/compiler";
import { GameSpecSchema, type GameSpec } from "../../../lib/therapy/schemas";
import { SerialSensor } from "../../../lib/racing/sensor";
import styles from "./therapy-game.module.css";

type Point = { x: number; y: number };

function demoSpec() {
  return generateGameSpec(extractExercisePlan("Right shoulder flexion, 2 sets of 8. Avoid trunk lean. No overhead reaching."), "demo-session");
}

export default function TherapyGame() {
  const [spec, setSpec] = useState<GameSpec | null>(null);
  const [range, setRange] = useState<CalibrationRange | null>(null);
  const [frame, setFrame] = useState<MovementFrame | null>(null);
  const [trajectory, setTrajectory] = useState<Point[]>([]);
  const [completed, setCompleted] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [gripLive, setGripLive] = useState(false);
  const gripSensor = useRef<SerialSensor | null>(null);
  const armed = useRef(false);
  const lastUnscorable = useRef(0);
  const holdStarted = useRef(0);
  const lastPlot = useRef(0);
  const smoothPlot = useRef(0);
  const socket = useRef<WebSocket | null>(null);
  const liveFrame = useRef<MovementFrame | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("therapy-game-spec");
    try {
      setSpec(stored ? GameSpecSchema.parse(JSON.parse(stored)) : demoSpec());
    } catch {
      setSpec(demoSpec());
    }
  }, []);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_THERAPY_AGENT_URL;
    const sessionId = sessionStorage.getItem("therapy-agent-session");
    if (!base || !sessionId) return;
    const wsUrl = `${base.replace(/^http/, "ws").replace(/\/$/, "")}/agents/therapy-game-agent/${sessionId}`;
    const ws = new WebSocket(wsUrl);
    socket.current = ws;
    return () => ws.close();
  }, []);

  const send = useCallback((payload: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(payload));
  }, []);

  const onFrame = useCallback((next: MovementFrame) => {
    liveFrame.current = next;
    setFrame(next);
    if (!spec || !range || paused || !started || completed >= spec.gameplay.targetCount) return;
    const span = Math.max(0.001, range.maximum - range.minimum);
    const normalizedRaw = Math.max(0, Math.min(1, (next.rawValue - range.minimum) / span));
    const hardware = gripSensor.current;
    const gripForce = hardware?.isLive(performance.now()) ? Math.max(0, Math.min(1, Math.abs(hardware.latest?.move ?? 0))) : null;
    const progress = spec.template === "fruit_catcher"
      ? (gripForce ?? 1 - normalizedRaw)
      : normalizedRaw;
    const now = performance.now();
    smoothPlot.current += (progress - smoothPlot.current) * 0.28;
    if (now - lastPlot.current > 90) {
      lastPlot.current = now;
      const plotted = Math.max(0, Math.min(1, smoothPlot.current));
      setTrajectory((points) => [...points.slice(-59), { x: next.x, y: plotted }]);
    }
    const confident = next.confidence >= spec.tracking.confidenceThreshold;
    if (!confident) send({ type: "movement_confidence", confidence: next.confidence });
    if (spec.template === "fruit_catcher" || spec.template === "sit_shapes") return;

    if (progress < 0.28) {
      armed.current = true;
      holdStarted.current = 0;
    }
    if (armed.current && progress > 0.72) {
      if (!confident) {
        if (now - lastUnscorable.current > 900) {
          lastUnscorable.current = now;
          setAttempted((value) => value + 1);
          send({ type: "attempt_unscorable", confidence: next.confidence });
        }
        return;
      }
      if (!holdStarted.current) holdStarted.current = now;
      if (now - holdStarted.current >= spec.gameplay.targetHoldMs) {
        armed.current = false;
        holdStarted.current = 0;
        setAttempted((value) => value + 1);
        setCompleted((value) => value + 1);
      }
    }
  }, [completed, paused, range, send, spec, started]);

  const progress = useMemo(() => {
    if (!frame || !range || !spec) return 0;
    const normalized = Math.max(0, Math.min(1, (frame.rawValue - range.minimum) / Math.max(.001, range.maximum - range.minimum)));
    const hardware = gripSensor.current;
    const gripForce = hardware?.isLive(performance.now()) ? Math.max(0, Math.min(1, Math.abs(hardware.latest?.move ?? 0))) : null;
    return spec.template === "fruit_catcher" ? (gripForce ?? 1 - normalized) : normalized;
  }, [frame, range, spec, gripLive]);

  useEffect(() => {
    if (!spec || completed !== spec.gameplay.targetCount) return;
    const averageConfidence = trajectory.length && frame ? frame.confidence : 0;
    send({
      type: "session_complete",
      summary: {
        completedReps: completed,
        attemptedReps: attempted,
        averageConfidence,
        unscorableAttempts: Math.max(0, attempted - completed),
        endedAt: new Date().toISOString()
      }
    });
  }, [attempted, completed, frame, send, spec, trajectory.length]);

  if (!spec) return <main className={styles.loading}>LOADING THERAPY GAME...</main>;

  const setNumber = Math.min(spec.exercise.sets, Math.floor(completed / spec.exercise.repetitions) + 1);
  const repNumber = completed % spec.exercise.repetitions;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/therapy"><ArrowLeft size={14} /> THERAPY PLAN</Link>
        <div><span>ROX GENERATED</span><b>{spec.title}</b></div>
        <span>SET {setNumber}/{spec.exercise.sets} · REP {repNumber}/{spec.exercise.repetitions}</span>
      </header>

      <div className={styles.layout}>
        <section className={styles.gameColumn}>
          <div className={styles.gameHud}>
            <span><small>CAMERA CONFIDENCE</small><b className={frame && frame.confidence >= spec.tracking.confidenceThreshold ? styles.confident : styles.notConfident}>{Math.round((frame?.confidence ?? 0) * 100)}%</b></span>
            <span><small>COMPLETED</small><b>{completed}/{spec.gameplay.targetCount}</b></span>
            <span><small>TRACKING</small><b>{gripLive ? "Grip-force hardware scoring" : spec.tracking.webcamMeasurementLabel}</b></span>
          </div>

          <div className={`${styles.gameStage} ${paused || !range ? styles.stagePaused : ""}`}>
            {spec.template === "arc_runner" && <ArcRunner progress={progress} completed={completed} />}
            {spec.template === "fruit_catcher" && (
              <FruitCatcher
                liveFrame={liveFrame}
                closure={progress}
                playing={started && !paused && !!range}
                targetCount={spec.gameplay.targetCount}
                confidenceThreshold={spec.tracking.confidenceThreshold}
                onCatch={(confident) => {
                  setAttempted((value) => value + 1);
                  if (confident) setCompleted((value) => Math.min(spec.gameplay.targetCount, value + 1));
                  else send({ type: "attempt_unscorable", confidence: liveFrame.current?.confidence ?? 0 });
                }}
              />
            )}
            {spec.template === "sit_shapes" && (
              <SitShapes
                liveFrame={liveFrame}
                range={range ?? { minimum: 0, maximum: 1 }}
                playing={started && !paused}
                holdMs={Math.max(450, spec.gameplay.targetHoldMs)}
                confidenceThreshold={spec.tracking.confidenceThreshold}
                completed={completed}
                targetCount={spec.gameplay.targetCount}
                onMatch={(confident) => {
                  setAttempted((value) => value + 1);
                  if (confident) setCompleted((value) => Math.min(spec.gameplay.targetCount, value + 1));
                  else send({ type: "attempt_unscorable", confidence: liveFrame.current?.confidence ?? 0 });
                }}
              />
            )}
            {!range && <div className={styles.stageMessage}><ShieldAlert size={25} /><b>CALIBRATION REQUIRED</b><span>Use only the movement range your therapist instructed.</span></div>}
            {range && !started && <div className={styles.stageMessage}><Play size={25} /><b>READY TO START</b><span>Camera placement and landmarks are confirmed.</span><button className={styles.startSession} onClick={() => { setStarted(true); setPaused(false); send({ type: "start_calibration" }); }}>START SESSION</button></div>}
            {paused && range && started && <div className={styles.stageMessage}><Pause size={25} /><b>GAME PAUSED</b></div>}
          </div>

          <div className={styles.trajectory}>
            <div>
              <span>{spec.template === "fruit_catcher" ? "GRIP LINE" : spec.template === "sit_shapes" ? "SHAPE MATCH" : "TARGET TRAJECTORY"}</span>
              <i className={styles.targetLine} />
              <span>{spec.template === "fruit_catcher" ? "YOUR GRIP" : spec.template === "sit_shapes" ? "YOUR LEGS" : "ACTUAL TRAJECTORY"}</span>
              <i className={styles.actualLine} />
            </div>
            <svg viewBox="0 0 600 100" preserveAspectRatio="none">
              {spec.template === "fruit_catcher" || spec.template === "sit_shapes" ? (
                <line x1="0" y1="35" x2="600" y2="35" className={styles.gripTarget} />
              ) : (
                <path d="M0 80 C100 80 110 20 200 20 S300 80 400 80 S500 20 600 20" />
              )}
              <polyline points={trajectory.map((point, index) => `${index * 10},${94 - point.y * 82}`).join(" ")} />
            </svg>
          </div>

          <div className={styles.actions}>
            <button onClick={() => setPaused((value) => !value)} disabled={!range}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "RESUME" : "PAUSE"}</button>
            <button onClick={() => { setRange(null); setStarted(false); setTrajectory([]); setCameraKey((value) => value + 1); }}><RefreshCw size={14} /> RECALIBRATE</button>
            {spec.tracking.hardwareGripPreferred && (
              <button onClick={() => {
                gripSensor.current ??= new SerialSensor();
                void gripSensor.current.connect().then(() => setGripLive(gripSensor.current?.status === "connected"));
              }}><Usb size={14} /> {gripLive ? "GRIP SENSOR LINKED" : "CONNECT GRIP SENSOR"}</button>
            )}
          </div>
        </section>

        <aside className={styles.side}>
          <CameraCalibration key={cameraKey} spec={spec} onFrame={onFrame} onCalibrated={(nextRange) => { setRange(nextRange); setStarted(false); setPaused(true); }} />
          <section className={styles.instructions}>
            <span>THERAPIST INSTRUCTIONS</span>
            <b>{spec.exercise.movement}</b>
            <p>{spec.exercise.repetitions} repetitions · {spec.exercise.sets} sets{spec.exercise.holdDurationSeconds ? ` · hold ${spec.exercise.holdDurationSeconds}s` : ""}</p>
            {spec.safety.warnings.map((warning, index) => <small key={`${warning}-${index}`}><ShieldAlert size={12} />{warning}</small>)}
          </section>
        </aside>
      </div>
    </main>
  );
}

function ArcRunner({ progress, completed }: { progress: number; completed: number }) {
  return (
    <div className={styles.arcRunner}>
      <div className={styles.arcSky}><i /><i /><i /></div>
      {[0,1,2,3].map((gate) => <span className={styles.arcGate} style={{ left: `${28 + gate * 23}%`, height: `${35 + (gate % 2) * 22}%` }} key={gate} />)}
      <div className={styles.squareHero} style={{ bottom: `${12 + progress * 66}%` }}><i /></div>
      <b>ARC {completed + 1}</b>
    </div>
  );
}

const FRUIT_SPRITES = [
  { name: "apple", src: "/therapy/apple.png?v=2" },
  { name: "banana", src: "/therapy/banana.png?v=2" },
  { name: "peach", src: "/therapy/peach.png?v=2" },
  { name: "orange", src: "/therapy/orange.png?v=2" },
  { name: "grapes", src: "/therapy/grapes.png?v=2" }
] as const;

function nextFruit(id: number, y = -18) {
  return {
    id,
    x: 16 + ((id * 53) % 68),
    y,
    sprite: FRUIT_SPRITES[id % FRUIT_SPRITES.length]
  };
}

function FruitCatcher({
  liveFrame,
  closure,
  playing,
  targetCount,
  confidenceThreshold,
  onCatch
}: {
  liveFrame: { current: MovementFrame | null };
  closure: number;
  playing: boolean;
  targetCount: number;
  confidenceThreshold: number;
  onCatch: (confident: boolean) => void;
}) {
  const catcherNode = useRef<HTMLDivElement>(null);
  const fruitNode = useRef<HTMLDivElement>(null);
  const fruitImg = useRef<HTMLImageElement>(null);
  const labelNode = useRef<HTMLElement>(null);
  const scoreNode = useRef<HTMLElement>(null);
  const closureRef = useRef(closure);
  const playingRef = useRef(playing);
  const onCatchRef = useRef(onCatch);
  const thresholdRef = useRef(confidenceThreshold);
  const motion = useRef({ catcherX: 50, fruit: nextFruit(1), score: 0, nextId: 2 });

  closureRef.current = closure;
  playingRef.current = playing;
  onCatchRef.current = onCatch;
  thresholdRef.current = confidenceThreshold;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      const frame = liveFrame.current;
      const gripping = closureRef.current > 0.72;
      const target = frame ? Math.max(12, Math.min(88, frame.x * 100)) : motion.current.catcherX;
      motion.current.catcherX += (target - motion.current.catcherX) * 0.28;
      if (catcherNode.current) {
        catcherNode.current.style.left = `${motion.current.catcherX}%`;
        catcherNode.current.classList.toggle(styles.catcherGrip, gripping);
      }
      if (labelNode.current) labelNode.current.textContent = gripping ? "GRIP" : "OPEN HAND · GRIP TO CATCH";

      const speed = playingRef.current
        ? 0.010 + Math.min(motion.current.score, 10) * 0.0024
        : 0.006;
      const fruit = motion.current.fruit;
      fruit.y += dt * speed;
      const overBasket = fruit.y > 66 && fruit.y < 84 && Math.abs(fruit.x - motion.current.catcherX) < 10;
      if (playingRef.current && overBasket && gripping) {
        const confident = (frame?.confidence ?? 0) >= thresholdRef.current;
        motion.current.score += 1;
        onCatchRef.current(confident);
        motion.current.fruit = nextFruit(motion.current.nextId++, -20);
      } else if (fruit.y > 108) {
        motion.current.fruit = nextFruit(motion.current.nextId++, -20);
      }

      const current = motion.current.fruit;
      if (fruitNode.current) {
        fruitNode.current.style.left = `${current.x}%`;
        fruitNode.current.style.top = `${current.y}%`;
      }
      if (fruitImg.current && fruitImg.current.dataset.sprite !== current.sprite.name) {
        fruitImg.current.dataset.sprite = current.sprite.name;
        fruitImg.current.src = current.sprite.src;
        fruitImg.current.alt = current.sprite.name;
      }
      if (scoreNode.current) scoreNode.current.textContent = `SCORE ${motion.current.score}/${targetCount}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [liveFrame, targetCount]);

  return (
    <div className={styles.fruitCatcher}>
      <strong ref={scoreNode} className={styles.fruitScore}>SCORE 0/{targetCount}</strong>
      <div className={styles.fruit} ref={fruitNode} style={{ left: `${motion.current.fruit.x}%`, top: `${motion.current.fruit.y}%` }}>
        <img ref={fruitImg} data-sprite={motion.current.fruit.sprite.name} src={motion.current.fruit.sprite.src} alt={motion.current.fruit.sprite.name} />
      </div>
      <div className={styles.catcher} ref={catcherNode} style={{ left: "50%" }}>
        <img src="/therapy/basket.png?v=2" alt="Basket" />
      </div>
      <b ref={labelNode}>OPEN HAND · GRIP TO CATCH</b>
    </div>
  );
}

const LEG_SHAPES = [
  { id: "together", label: "TOGETHER · VERTICAL", left: 0.2, right: 0.2 },
  { id: "split-a", label: "ONE HIGH · ONE LOW", left: 0.84, right: 0.16 },
  { id: "both-high", label: "BOTH HIGH", left: 0.82, right: 0.82 },
  { id: "split-b", label: "ONE HIGH · ONE LOW", left: 0.16, right: 0.84 }
] as const;

function SitShapes({
  liveFrame,
  range,
  playing,
  holdMs,
  confidenceThreshold,
  completed,
  targetCount,
  onMatch
}: {
  liveFrame: { current: MovementFrame | null };
  range: CalibrationRange;
  playing: boolean;
  holdMs: number;
  confidenceThreshold: number;
  completed: number;
  targetCount: number;
  onMatch: (confident: boolean) => void;
}) {
  const nearLeg = useRef<HTMLDivElement>(null);
  const farLeg = useRef<HTMLDivElement>(null);
  const ghostNear = useRef<HTMLDivElement>(null);
  const ghostFar = useRef<HTMLDivElement>(null);
  const labelNode = useRef<HTMLElement>(null);
  const matchNode = useRef<HTMLElement>(null);
  const playingRef = useRef(playing);
  const onMatchRef = useRef(onMatch);
  const holdRef = useRef(0);
  const lockedRef = useRef(false);

  playingRef.current = playing;
  onMatchRef.current = onMatch;

  useEffect(() => {
    let raf = 0;
    const span = Math.max(0.02, range.maximum - range.minimum);
    const tick = () => {
      const shape = LEG_SHAPES[completed % LEG_SHAPES.length];
      const frame = liveFrame.current;
      const lift = (value: number) => Math.max(0, Math.min(1, (value - range.minimum) / span));
      const left = frame ? lift(frame.leftLeg) : 0;
      const right = frame ? lift(frame.rightLeg) : 0;
      const error = (Math.abs(left - shape.left) + Math.abs(right - shape.right)) / 2;
      const matched = playingRef.current && error < 0.18;
      if (ghostNear.current) ghostNear.current.style.bottom = `${10 + shape.left * 58}%`;
      if (ghostFar.current) ghostFar.current.style.bottom = `${10 + shape.right * 58}%`;
      if (nearLeg.current) nearLeg.current.style.bottom = `${10 + left * 58}%`;
      if (farLeg.current) farLeg.current.style.bottom = `${10 + right * 58}%`;
      if (labelNode.current) labelNode.current.textContent = shape.label;
      if (matchNode.current) {
        matchNode.current.textContent = matched ? "HOLD THE SHAPE" : "LIFT TO MATCH";
        matchNode.current.className = matched ? styles.shapeHot : styles.shapeHint;
      }
      if (matched) {
        if (!holdRef.current) holdRef.current = performance.now();
        if (!lockedRef.current && performance.now() - holdRef.current >= holdMs) {
          lockedRef.current = true;
          const confident = (frame?.confidence ?? 0) >= confidenceThreshold;
          onMatchRef.current(confident);
        }
      } else {
        holdRef.current = 0;
        lockedRef.current = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [completed, confidenceThreshold, holdMs, liveFrame, range]);

  return (
    <div className={styles.sitShapes}>
      <b ref={labelNode}>TOGETHER · VERTICAL</b>
      <strong>SHAPE {(completed % LEG_SHAPES.length) + 1}/{LEG_SHAPES.length}</strong>
      <div className={styles.chair} />
      <div className={`${styles.leg} ${styles.ghostLeg} ${styles.farLeg}`} ref={ghostFar} />
      <div className={`${styles.leg} ${styles.ghostLeg} ${styles.nearLeg}`} ref={ghostNear} />
      <div className={`${styles.leg} ${styles.playerLeg} ${styles.farLeg}`} ref={farLeg} />
      <div className={`${styles.leg} ${styles.playerLeg} ${styles.nearLeg}`} ref={nearLeg} />
      <span ref={matchNode} className={styles.shapeHint}>LIFT TO MATCH</span>
      <small>{completed}/{targetCount} MATCHED</small>
    </div>
  );
}
