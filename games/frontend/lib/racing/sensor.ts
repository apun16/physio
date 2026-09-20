/**
 * IMU sensor adapter for the racing game.
 *
 * Reads the line stream from the ESP-32 firmware over Web Serial. Two layouts
 * are accepted, so either sketch can be flashed:
 *   htn_claude_filter.ino (5 fields): roll,pitch,yaw,steer,move
 *   htn_final.ino         (8 fields): roll,pitch,yaw,steer,moveX,moveY,rawFsr,squeeze
 * Angles are degrees relative to neutral; steer/move/squeeze are normalised -1..1
 * (squeeze 0..1). Lines starting with '#' are firmware status text and are ignored.
 *
 * The ESP32 shows up as a serial port either over USB or once paired over
 * Bluetooth Classic (e.g. /dev/cu.ESP32_HTN on macOS). Web Serial needs Chrome/Edge.
 */

export interface SensorFrame {
  roll: number;
  pitch: number;
  yaw: number;
  steer: number;
  /**
   * Lateral move axis (moveX on the 8-field firmware). This is a cumulative
   * distance from the last calibration point, not a bounded -1..1 reading, so
   * it is passed through unclamped; clamping pinned it at 1 and silently froze
   * the signal after about one sweep.
   */
  move: number;
  /** vertical move axis, 8-field firmware only; cumulative like move. */
  moveY: number | null;
  /** force sensor, normalised 0..1; 8-field firmware only */
  squeeze: number | null;
  /** raw force sensor ADC count, 8-field firmware only */
  rawFsr: number | null;
  /** performance.now() when the frame arrived */
  t: number;
}

export type SensorStatus = "unsupported" | "disconnected" | "connecting" | "connected";

/** Optional reliability observer. Games keep working if nobody subscribes. */
export type SensorReliabilityKind =
  | "connecting"
  | "connected"
  | "first_valid_frame"
  | "malformed_frame"
  | "invalid_values"
  | "frozen_readings"
  | "unrealistic_jump"
  | "command_write_failed"
  | "command_sent"
  | "firmware_ack"
  | "command_ack_timeout"
  | "read_loop_failure"
  | "unexpected_disconnect"
  | "intentionally_disconnected"
  | "port_open_failed"
  | "port_picker_cancelled"
  | "unsupported";

export type SensorReliabilityEvent = {
  kind: SensorReliabilityKind;
  at: number;
};

/** Firmware single-char commands (see handleCommand in the .ino). */
export type SensorCommand = "center" | "rollRight" | "rollLeft" | "gyroCal";
const COMMAND_CHAR: Record<SensorCommand, string> = { center: "c", rollRight: "r", rollLeft: "l", gyroCal: "b" };

/** No frame for this long while connected = signal lost. */
export const STALE_AFTER_MS = 60_000;

/** Identical MPU6050 readings for this long can mean a stuck sensor — not a player holding still. */
export const FROZEN_AFTER_MS = 60_000;

/** Debug output: browser console plus the `npm run dev` terminal (via /api/sensor-log). */
export function sensorLog(message: string) {
  console.log(`[sensor] ${message}`);
  if (typeof fetch === "undefined") return;
  fetch("/api/sensor-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), keepalive: true }).catch(() => undefined);
}

const clamp1 = (value: number) => Math.max(-1, Math.min(1, value));
/**
 * Squeeze arrives as 0..1 from the firmware, but the game-facing mapping is the
 * 0..255 byte (see the squeeze_255 line in full.py). Accept either: anything
 * above 1 is treated as the byte scale and brought back to 0..1.
 */
const normSqueeze = (value: number) => (value > 1.5 ? value / 255 : value);

export function parseFrame(line: string, t: number): SensorFrame | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  const parts = text.split(",");
  // 5 = htn_claude_filter.ino, 8 = htn_final.ino (adds moveY, force sensor).
  if (parts.length !== 5 && parts.length !== 8) return null;
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [roll, pitch, yaw, steer, move, moveY, rawFsr, squeeze] = values;
  return {
    roll,
    pitch,
    yaw,
    steer: clamp1(steer),
    move,
    moveY: parts.length === 8 ? moveY : null,
    squeeze: parts.length === 8 ? Math.max(0, Math.min(1, normSqueeze(squeeze))) : null,
    rawFsr: parts.length === 8 ? rawFsr : null,
    t
  };
}

/** Classifies a rejected line without exposing the raw packet. */
export function classifyRejectedLine(line: string): "empty" | "status" | "wrong_field_count" | "non_finite" | "valid" {
  const text = line.trim();
  if (!text) return "empty";
  if (text.startsWith("#")) return "status";
  const parts = text.split(",");
  if (parts.length !== 5 && parts.length !== 8) return "wrong_field_count";
  if (parts.map(Number).some((value) => !Number.isFinite(value))) return "non_finite";
  return "valid";
}

// Web Serial isn't in lib.dom yet; declare the bits we use.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}
const getSerial = () => (typeof navigator === "undefined" ? undefined : (navigator as unknown as { serial?: SerialLike }).serial);

export class SerialSensor {
  status: SensorStatus = getSerial() ? "disconnected" : "unsupported";
  latest: SensorFrame | null = null;
  error = "";

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private listeners = new Set<() => void>();
  private reliabilityListeners = new Set<(event: SensorReliabilityEvent) => void>();
  private intentionalClose = false;
  private readFailed = false;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSignature = "";
  private freezeStartedAt = 0;
  private lastSample: SensorFrame | null = null;
  private lastJumpAt = 0;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  subscribeReliability(listener: (event: SensorReliabilityEvent) => void) {
    this.reliabilityListeners.add(listener);
    return () => { this.reliabilityListeners.delete(listener); };
  }

  private emitReliability(kind: SensorReliabilityKind) {
    const event: SensorReliabilityEvent = { kind, at: typeof performance !== "undefined" ? performance.now() : Date.now() };
    for (const listener of this.reliabilityListeners) {
      try { listener(event); } catch { /* observer failures must never break IMU */ }
    }
  }

  /** True when connected and a frame arrived recently. */
  isLive(now: number) {
    return this.status === "connected" && this.latest !== null && now - this.latest.t < STALE_AFTER_MS;
  }

  async connect() {
    const serial = getSerial();
    if (!serial) {
      this.emitReliability("unsupported");
      return;
    }
    if (this.status === "connecting" || this.status === "connected") return;
    this.error = "";
    this.intentionalClose = false;
    this.readFailed = false;
    this.lastSignature = "";
    this.freezeStartedAt = 0;
    this.lastSample = null;
    this.clearAckWait();
    try {
      sensorLog("opening port picker...");
      const port = await serial.requestPort();
      this.setStatus("connecting");
      this.emitReliability("connecting");
      sensorLog("port chosen, opening at 115200 baud...");
      await port.open({ baudRate: 115200 });
      sensorLog("port OPEN. Waiting for data (nothing below = port opened but ESP32 sent no bytes)");
      this.port = port;
      this.latest = null;
      this.setStatus("connected");
      this.emitReliability("connected");
      void this.readLoop(port);
    } catch (reason) {
      // Picker dismissed or port busy.
      this.port = null;
      const cancelled = reason instanceof Error && reason.name === "NotFoundError";
      this.error = cancelled ? "" : reason instanceof Error ? reason.message : "";
      sensorLog(`connect failed: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`);
      this.setStatus("disconnected");
      this.emitReliability(cancelled ? "port_picker_cancelled" : "port_open_failed");
    }
  }

  async disconnect() {
    this.intentionalClose = true;
    await this.reader?.cancel().catch(() => undefined); // readLoop closes the port
  }

  async send(command: SensorCommand) {
    const writable = this.port?.writable;
    if (!writable) return;
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(COMMAND_CHAR[command]));
      this.emitReliability("command_sent");
      this.waitForAck();
    } catch {
      this.emitReliability("command_write_failed");
      this.clearAckWait();
    } finally {
      writer.releaseLock();
    }
  }

  private async readLoop(port: SerialPortLike) {
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    let frames = 0;
    let rejected = 0;
    const report = () => {
      const f = this.latest;
      sensorLog(`bytes=${bytes} frames=${frames} rejected=${rejected} latest=${f ? `roll=${f.roll} steer=${f.steer} move=${f.move}` : "none"}`);
    };
    const reportTimer = setInterval(report, 1000);
    try {
      while (port.readable) {
        this.reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            bytes += value.length;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
              const rawLine = buffer.slice(0, newline);
              const frame = parseFrame(rawLine, performance.now());
              if (frame) {
                this.noteValidFrame(frame);
                this.latest = frame;
                frames += 1;
                if (frames === 1) this.emitReliability("first_valid_frame");
                if (frames <= 3) sensorLog(`first frames: ${JSON.stringify(rawLine.trim())} -> steer=${frame.steer}`);
              } else {
                const classified = classifyRejectedLine(rawLine);
                if (classified === "status") {
                  this.clearAckWait();
                  this.emitReliability("firmware_ack");
                  sensorLog(`firmware says: ${rawLine.trim()}`);
                } else if (classified === "wrong_field_count") {
                  rejected += 1;
                  this.emitReliability("malformed_frame");
                  if (rejected <= 5) sensorLog(`rejected line: ${JSON.stringify(rawLine.trim())} (expected 5 comma-separated numbers)`);
                } else if (classified === "non_finite") {
                  rejected += 1;
                  this.emitReliability("invalid_values");
                  if (rejected <= 5) sensorLog(`rejected line: ${JSON.stringify(rawLine.trim())} (expected 5 comma-separated numbers)`);
                }
              }
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf("\n");
            }
            if (buffer.length > 512) buffer = ""; // garbage without newlines
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
        break; // cancelled or stream ended
      }
    } catch (reason) {
      this.error = reason instanceof Error ? reason.message : "Sensor read failed";
      sensorLog(`read error: ${this.error}`);
      this.readFailed = true;
      if (!this.intentionalClose) this.emitReliability("read_loop_failure");
    } finally {
      clearInterval(reportTimer);
      this.clearAckWait();
      report();
      sensorLog("port closed");
      await port.close().catch(() => undefined);
      this.port = null;
      this.latest = null;
      this.lastSample = null;
      this.setStatus("disconnected");
      if (this.intentionalClose) this.emitReliability("intentionally_disconnected");
      else if (!this.readFailed) this.emitReliability("unexpected_disconnect");
      this.intentionalClose = false;
      this.readFailed = false;
    }
  }

  private noteValidFrame(frame: SensorFrame) {
    const signature = `${Math.round(frame.roll * 10)}:${Math.round(frame.pitch * 10)}:${Math.round(frame.yaw * 10)}:${Math.round(frame.steer * 100)}:${Math.round(frame.move * 100)}`;
    if (signature === this.lastSignature) {
      if (!this.freezeStartedAt) this.freezeStartedAt = frame.t;
      else if (frame.t - this.freezeStartedAt > FROZEN_AFTER_MS) {
        this.emitReliability("frozen_readings");
        this.freezeStartedAt = frame.t;
      }
    } else {
      this.lastSignature = signature;
      this.freezeStartedAt = 0;
    }
    const previous = this.lastSample;
    this.lastSample = frame;
    if (!previous || frame.t - previous.t > 80) return;
    if (frame.t - this.lastJumpAt < 8000) return;
    const dRoll = Math.abs(frame.roll - previous.roll);
    const dPitch = Math.abs(frame.pitch - previous.pitch);
    const dYaw = Math.abs(frame.yaw - previous.yaw);
    const dSteer = Math.abs(frame.steer - previous.steer);
    // `move` is cumulative distance on 8-field firmware, so a normal slash
    // can jump well past 1. That is gameplay, not a sensor failure.
    if (dRoll > 80 || dPitch > 80 || dYaw > 80 || dSteer > 1.35) {
      this.lastJumpAt = frame.t;
      this.emitReliability("unrealistic_jump");
    }
  }

  private waitForAck() {
    this.clearAckWait();
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.emitReliability("command_ack_timeout");
    }, 4500);
  }

  private clearAckWait() {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
  }

  private setStatus(status: SensorStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }
}
