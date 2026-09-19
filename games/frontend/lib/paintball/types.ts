export type InputMode = "kbm" | "sim" | "imu";
export type SqueezePhase = "READY" | "AIMING" | "AIMING_HELD" | "RELEASED" | "COOLDOWN";
export type DodgeState = "CENTER" | "LEFT" | "RIGHT" | "DUCK";
export type TargetKind = "basic" | "moving" | "armoured";
export type GamePhase = "boot" | "calibrate" | "practice" | "countdown" | "play" | "pause" | "over";
export type CalibStep = "hold" | "centre" | "range" | "test" | "ready";

export type ImuSample = {
  orientation: { pitch: number; yaw: number; roll: number };
  squeeze: number;
  timestamp: number;
};

export type AimSample = { x: number; y: number };

export type HudSnapshot = {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  score: number;
  wave: number;
  combo: number;
  accuracy: number;
  hits: number;
  misses: number;
  defeats: number;
  coverage: number;
  survival: number;
  longestCombo: number;
  toast: string;
  shootState: SqueezePhase;
  aiming: boolean;
  imu: "off" | "sim" | "live" | "lost";
  mode: InputMode;
  dodge: DodgeState;
  count: number;
  hitFlash: number;
  dodgeFlash: number;
  debug: {
    pitch: number;
    yaw: number;
    roll: number;
    squeeze: number;
    connected: boolean;
    noise: boolean;
    aim: AimSample;
  };
};
