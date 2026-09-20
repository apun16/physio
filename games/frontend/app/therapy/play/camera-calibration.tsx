"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, RefreshCw, ShieldAlert } from "lucide-react";
import type { GameSpec } from "../../../lib/therapy/schemas";
import styles from "./therapy-game.module.css";

type Landmark = { x: number; y: number; visibility?: number; presence?: number };

export type MovementFrame = {
  x: number;
  y: number;
  rawValue: number;
  leftLeg: number;
  rightLeg: number;
  confidence: number;
  compensation: number;
  at: number;
};

export type CalibrationRange = { minimum: number; maximum: number };

type Landmarker = {
  detectForVideo(video: HTMLVideoElement, timestamp: number): {
    landmarks: Landmark[][];
    handednesses?: { score: number }[][];
  };
  close(): void;
};

const HAND_BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const POSE_BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,31],[24,26],[26,28],[28,32]];
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

function landmarkConfidence(point?: Landmark) {
  if (!point) return 0;
  const onScreen = point.x >= -0.08 && point.x <= 1.08 && point.y >= -0.08 && point.y <= 1.08;
  if (!onScreen) return 0.12;
  if (typeof point.visibility === "number") return point.visibility;
  if (typeof point.presence === "number") return point.presence;
  return 0.84;
}

async function withDelegateFallback<T>(create: (delegate: "GPU" | "CPU") => Promise<T>) {
  try {
    return await create("GPU");
  } catch {
    return create("CPU");
  }
}

export default function CameraCalibration({
  spec,
  onFrame,
  onCalibrated
}: {
  spec: GameSpec;
  onFrame: (frame: MovementFrame) => void;
  onCalibrated: (range: CalibrationRange) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const rafRef = useRef(0);
  const latestRef = useRef<MovementFrame | null>(null);
  const captureRef = useRef<{ minimum: number; maximum: number; samples: number; until: number } | null>(null);
  const onFrameRef = useRef(onFrame);
  const smoothRef = useRef({ x: 0.5, y: 0.5, rawValue: 1, leftLeg: 0, rightLeg: 0, confidence: 0, ready: false });
  const hudAtRef = useRef(0);
  const [status, setStatus] = useState<"off" | "loading" | "live" | "capturing" | "ready">("off");
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState("");

  onFrameRef.current = onFrame;

  useEffect(() => () => stop(), []);

  async function start() {
    setStatus("loading");
    setError("");
    try {
      const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      landmarkerRef.current = spec.tracking.mode === "hand"
        ? await withDelegateFallback((delegate) => HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate },
            runningMode: "VIDEO",
            numHands: 1
          })) as unknown as Landmarker
        : await withDelegateFallback((delegate) => PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: "VIDEO",
            numPoses: 1
          })) as unknown as Landmarker;
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable");
      video.srcObject = streamRef.current;
      await video.play();
      smoothRef.current = { x: 0.5, y: 0.5, rawValue: 1, leftLeg: 0, rightLeg: 0, confidence: 0, ready: false };
      setStatus("live");
      loop();
    } catch (reason) {
      stop();
      setError(reason instanceof Error ? reason.message : "Camera could not start");
      setStatus("off");
    }
  }

  function stop() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    landmarkerRef.current?.close();
    streamRef.current = null;
    landmarkerRef.current = null;
  }

  function movement(landmarks: Landmark[], score: number): MovementFrame {
    if (spec.tracking.mode === "hand") {
      const wrist = landmarks[0];
      const palm = landmarks[9] ?? wrist;
      const width = Math.max(distance(landmarks[5], landmarks[17]), 0.02);
      const span = Math.max(distance(wrist, palm), width, 0.03);
      const closureDistance = [4, 8, 12, 16, 20].reduce((sum, index) => sum + distance(landmarks[index] ?? palm, palm), 0) / 5 / span;
      return {
        x: 1 - (wrist.x * 0.7 + palm.x * 0.3),
        y: palm.y,
        rawValue: closureDistance,
        leftLeg: 0,
        rightLeg: 0,
        confidence: Math.max(score, 0.55),
        compensation: 0,
        at: performance.now()
      };
    }

    const shoulderMid = (landmarks[11].x + landmarks[12].x) / 2;
    const hipMid = (landmarks[23].x + landmarks[24].x) / 2;
    const trunkLean = Math.min(1, Math.abs(shoulderMid - hipMid) / 0.22);

    if (spec.tracking.metric === "seated_leg_lift") {
      const hipY = ((landmarks[23]?.y ?? 0.5) + (landmarks[24]?.y ?? 0.5)) / 2;
      const leftAnkle = landmarks[27] ?? landmarks[28];
      const rightAnkle = landmarks[28] ?? landmarks[27];
      const leftKnee = landmarks[25] ?? leftAnkle;
      const rightKnee = landmarks[26] ?? rightAnkle;
      const leftLift = hipY - ((leftAnkle?.y ?? 0.9) * 0.65 + (leftKnee?.y ?? 0.7) * 0.35);
      const rightLift = hipY - ((rightAnkle?.y ?? 0.9) * 0.65 + (rightKnee?.y ?? 0.7) * 0.35);
      const bodyVisible = Math.min(
        landmarkConfidence(landmarks[23]),
        landmarkConfidence(landmarks[24]),
        landmarkConfidence(leftKnee),
        landmarkConfidence(rightKnee),
        landmarkConfidence(leftAnkle),
        landmarkConfidence(rightAnkle)
      );
      return {
        x: 1 - ((leftAnkle?.x ?? 0.5) + (rightAnkle?.x ?? 0.5)) / 2,
        y: ((leftAnkle?.y ?? 0.8) + (rightAnkle?.y ?? 0.8)) / 2,
        rawValue: (leftLift + rightLift) / 2,
        leftLeg: leftLift,
        rightLeg: rightLift,
        confidence: bodyVisible,
        compensation: trunkLean,
        at: performance.now()
      };
    }

    const right = spec.exercise.side !== "left";
    const [shoulder, wrist] = right ? [12, 16] : [11, 15];
    return {
      x: 1 - landmarks[wrist].x,
      y: landmarks[wrist].y,
      rawValue: 1 - landmarks[wrist].y,
      leftLeg: 0,
      rightLeg: 0,
      confidence: Math.min(landmarkConfidence(landmarks[shoulder]), landmarkConfidence(landmarks[wrist]), landmarkConfidence(landmarks[11]), landmarkConfidence(landmarks[12])),
      compensation: trunkLean,
      at: performance.now()
    };
  }

  function smoothFrame(frame: MovementFrame): MovementFrame {
    const current = smoothRef.current;
    if (!current.ready) {
      smoothRef.current = {
        x: frame.x,
        y: frame.y,
        rawValue: frame.rawValue,
        leftLeg: frame.leftLeg,
        rightLeg: frame.rightLeg,
        confidence: frame.confidence,
        ready: true
      };
      return frame;
    }
    const alpha = spec.tracking.mode === "hand" ? 0.34 : 0.28;
    current.x += (frame.x - current.x) * alpha;
    current.y += (frame.y - current.y) * alpha;
    current.rawValue += (frame.rawValue - current.rawValue) * alpha;
    current.leftLeg += (frame.leftLeg - current.leftLeg) * alpha;
    current.rightLeg += (frame.rightLeg - current.rightLeg) * alpha;
    current.confidence += (frame.confidence - current.confidence) * alpha;
    return {
      ...frame,
      x: current.x,
      y: current.y,
      rawValue: current.rawValue,
      leftLeg: current.leftLeg,
      rightLeg: current.rightLeg,
      confidence: current.confidence
    };
  }

  function loop() {
    const tick = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      if (video.readyState >= 2) {
        const result = landmarker.detectForVideo(video, performance.now());
        const landmarks = result.landmarks[0];
        if (landmarks) {
          const score = result.handednesses?.[0]?.[0]?.score ?? 0.9;
          const frame = smoothFrame(movement(landmarks, score));
          latestRef.current = frame;
          if (performance.now() - hudAtRef.current > 80) {
            hudAtRef.current = performance.now();
            setConfidence(frame.confidence);
          }
          onFrameRef.current(frame);
          draw(landmarks);
          const capture = captureRef.current;
          const captureFloor = Math.min(0.45, spec.tracking.confidenceThreshold * 0.75);
          if (capture && frame.confidence >= captureFloor) {
            capture.minimum = Math.min(capture.minimum, frame.rawValue);
            capture.maximum = Math.max(capture.maximum, frame.rawValue);
            capture.samples += 1;
            if (performance.now() >= capture.until) {
              captureRef.current = null;
              if (capture.samples < 8 || capture.maximum - capture.minimum < 0.02) {
                setError(spec.template === "sit_shapes"
                  ? "Not enough leg movement was visible. Sit side-on and lift through your prescribed range."
                  : "Not enough movement was visible. Reposition the camera and capture again.");
                setStatus("live");
              } else {
                setStatus("ready");
                onCalibrated({ minimum: capture.minimum, maximum: capture.maximum });
              }
            }
          }
        } else {
          const last = latestRef.current;
          if (last) {
            const faded = { ...last, confidence: last.confidence * 0.86, at: performance.now() };
            latestRef.current = faded;
            onFrameRef.current(faded);
            if (performance.now() - hudAtRef.current > 80) {
              hudAtRef.current = performance.now();
              setConfidence(faded.confidence);
            }
          } else {
            setConfidence(0);
          }
          draw([]);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function draw(landmarks: Landmark[]) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks.length) return;
    const bones = spec.tracking.mode === "hand" ? HAND_BONES : POSE_BONES;
    ctx.strokeStyle = "#79eef1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of bones) {
      if (!landmarks[a] || !landmarks[b]) continue;
      ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
      ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffd36b";
    for (const point of landmarks) ctx.fillRect(point.x * canvas.width - 2, point.y * canvas.height - 2, 4, 4);
  }

  function captureRange() {
    if (!latestRef.current || confidence < Math.min(0.45, spec.tracking.confidenceThreshold * 0.75)) return;
    setError("");
    captureRef.current = {
      minimum: latestRef.current.rawValue,
      maximum: latestRef.current.rawValue,
      samples: 1,
      until: performance.now() + 6000
    };
    setStatus("capturing");
  }

  const guidance = spec.template === "sit_shapes"
    ? "Sit side-on to the camera so both hips, knees, and ankles stay in frame."
    : spec.template === "fruit_catcher"
      ? "Hold your hand in view with every fingertip visible."
      : "Keep your shoulder, wrist, and both sides of your torso visible.";

  const canCapture = confidence >= Math.min(0.45, spec.tracking.confidenceThreshold * 0.75);

  return (
    <section className={styles.cameraPanel}>
      <div className={styles.cameraView}>
        <video ref={videoRef} muted playsInline />
        <canvas ref={canvasRef} width={640} height={480} />
        <span className={confidence >= spec.tracking.confidenceThreshold ? styles.good : styles.low}>{Math.round(confidence * 100)}% CAMERA</span>
      </div>
      <div className={styles.cameraGuide}>
        <span>CAMERA CALIBRATION</span>
        <h2>{status === "ready" ? "Calibration ready" : guidance}</h2>
        <p>Move only through the range your therapist instructed. Video stays in this browser.</p>
        {error && <p className={styles.cameraError}><ShieldAlert size={14} />{error}</p>}
        {status === "off" && <button onClick={() => void start()}><Camera size={15} /> ENABLE CAMERA</button>}
        {status === "loading" && <button disabled><RefreshCw size={15} /> LOADING MODEL</button>}
        {status === "live" && <button disabled={!canCapture} onClick={captureRange}>CAPTURE SAFE RANGE</button>}
        {status === "capturing" && <button disabled><RefreshCw size={15} /> MOVE AS INSTRUCTED...</button>}
        {status === "ready" && <div className={styles.calibrated}><Check size={15} /> LANDMARKS AND RANGE CONFIRMED</div>}
      </div>
    </section>
  );
}
