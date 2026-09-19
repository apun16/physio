/**
 * Webcam hand tracker for the racing game.
 *
 * Runs MediaPipe Hand Landmarker fully in the browser (no server, no API key)
 * and exposes the palm centre in mirrored, 0..1 image space: x = 0 is the
 * user's left edge of the frame, x = 1 the right, y = 0 the top.
 *
 * On a Lenovo P16 Gen 2 (Windows) Chrome lists the RGB camera and an IR camera;
 * the IR one is skipped by label so the picker defaults to the colour feed.
 */

export interface HandFrame {
  x: number;
  y: number;
  /** performance.now() when the frame was detected */
  t: number;
}

export type CameraStatus = "unsupported" | "off" | "starting" | "live";

/** No hand detected for this long = hand lost. */
export const HAND_STALE_AFTER_MS = 500;

const MODEL_URL = "/mediapipe/hand_landmarker.task";
const WASM_URL = "/mediapipe/wasm";
/** Landmarks averaged for a steady palm centre: wrist + the four finger knuckles. */
const PALM = [0, 5, 9, 13, 17];
/** Bones for the preview overlay. */
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

interface Landmark { x: number; y: number }
interface LandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestamp: number): { landmarks: Landmark[][] };
  close(): void;
}

export class HandTracker {
  status: CameraStatus = typeof navigator !== "undefined" && "mediaDevices" in navigator ? "off" : "unsupported";
  latest: HandFrame | null = null;
  error = "";
  devices: MediaDeviceInfo[] = [];
  deviceId = "";

  private video: HTMLVideoElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: LandmarkerLike | null = null;
  private loading: Promise<LandmarkerLike> | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private smoothed: { x: number; y: number } | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isLive(now: number) {
    return this.status === "live" && this.latest !== null && now - this.latest.t < HAND_STALE_AFTER_MS;
  }

  attach(video: HTMLVideoElement | null, overlay: HTMLCanvasElement | null) {
    this.video = video;
    this.overlay = overlay;
  }

  async start(deviceId = this.deviceId): Promise<void> {
    if (this.status === "unsupported" || this.status === "starting") return;
    this.stop();
    this.error = "";
    this.setStatus("starting");
    try {
      const landmarker = await this.loadModel();
      const video = this.video;
      if (!video) throw new Error("Camera preview is not ready");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false
      });
      video.srcObject = this.stream;
      await video.play();
      // Labels only appear once permission is granted, so list devices after the first stream opens.
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      this.deviceId = this.stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
      const current = this.devices.find((d) => d.deviceId === this.deviceId);
      if (!deviceId && current && /\bIR\b|infrared/i.test(current.label)) {
        const colour = this.devices.find((d) => !/\bIR\b|infrared/i.test(d.label));
        if (colour) { this.setStatus("off"); return this.start(colour.deviceId); }
      }
      this.setStatus("live");
      this.loop(landmarker);
    } catch (reason) {
      this.stop();
      this.error = reason instanceof Error
        ? reason.name === "NotAllowedError" ? "Camera permission was blocked. Allow it in the address bar (Windows: Settings > Privacy > Camera)."
          : reason.name === "NotFoundError" ? "No camera found." : reason.message
        : "Camera failed to start";
      this.setStatus("off");
    }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.latest = null;
    this.smoothed = null;
    this.lastVideoTime = -1;
    this.overlay?.getContext("2d")?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.status !== "unsupported" && this.status !== "starting") this.setStatus("off");
  }

  private loadModel() {
    if (this.landmarker) return Promise.resolve(this.landmarker);
    this.loading ??= (async () => {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const options = (delegate: "GPU" | "CPU") => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "VIDEO" as const, numHands: 1 });
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
      }
      return this.landmarker as LandmarkerLike;
    })().catch((reason) => { this.loading = null; throw reason; });
    return this.loading;
  }

  private loop(landmarker: LandmarkerLike) {
    const tick = () => {
      const video = this.video;
      if (this.status !== "live" || !video) return;
      if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;
        const now = performance.now();
        const hand = landmarker.detectForVideo(video, now).landmarks[0];
        if (hand) {
          const rawX = 1 - PALM.reduce((sum, i) => sum + hand[i].x, 0) / PALM.length; // mirror so moving right = +x
          const rawY = PALM.reduce((sum, i) => sum + hand[i].y, 0) / PALM.length;
          // Light EMA takes the jitter out without adding noticeable lag.
          this.smoothed = this.smoothed ? { x: this.smoothed.x + (rawX - this.smoothed.x) * 0.6, y: this.smoothed.y + (rawY - this.smoothed.y) * 0.6 } : { x: rawX, y: rawY };
          this.latest = { x: this.smoothed.x, y: this.smoothed.y, t: now };
        }
        this.drawOverlay(hand);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private drawOverlay(hand: Landmark[] | undefined) {
    const canvas = this.overlay;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!hand) return;
    const point = (p: Landmark) => [(1 - p.x) * canvas.width, p.y * canvas.height] as const;
    ctx.strokeStyle = "#5ef0ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      const [ax, ay] = point(hand[a]);
      const [bx, by] = point(hand[b]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffd438";
    for (const p of hand) {
      const [px, py] = point(p);
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  }

  private setStatus(status: CameraStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }
}
