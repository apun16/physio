"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { SensorCommand, SerialSensor } from "../../lib/racing/sensor";
import { breadcrumbTransition, reportFailure, reportRecovery, reportSidekickFailure, reportSpan } from "../../lib/rehab-guardian/reporter";
import { reduce } from "../../lib/rehab-guardian/machine";
import { runRecovery } from "../../lib/rehab-guardian/recovery";
import { watchSensor } from "../../lib/rehab-guardian/watch";
import { INITIAL_GUARDIAN_STATE, type GuardianInputMode, type RecoveryMethod, type SanitizedIncident } from "../../lib/rehab-guardian/types";
import SentrySidekick from "./SentrySidekick";
import SidekickBoundary from "./SidekickBoundary";
import "./sidekick.css";

type Props = {
  sensor: SerialSensor;
  inputMode: GuardianInputMode;
  running: boolean;
  gameEnded?: boolean;
  onPause: () => void;
  onReconnect: () => void;
  onCalibrate: (command: SensorCommand) => void;
  onFallback: () => boolean | Promise<boolean>;
  onExit: () => void;
};

export default function RehabGuardianHost({ sensor, inputMode, running, gameEnded = false, onPause, onReconnect, onCalibrate, onFallback, onExit }: Props) {
  const [state, dispatch] = useReducer(reduce, INITIAL_GUARDIAN_STATE);
  const [payload, setPayload] = useState<SanitizedIncident | null>(null);
  const [calibratePending, setCalibratePending] = useState(false);
  const prevPhase = useRef(state.phase);
  const inputModeRef = useRef(inputMode);
  const endedRef = useRef(gameEnded);
  inputModeRef.current = inputMode;
  endedRef.current = gameEnded;

  useEffect(() => {
    dispatch({ type: "session_start" });
    reportSpan("imu.session", "start");
    const greet = window.setTimeout(() => dispatch({ type: "dismiss_greeting" }), 4000);
    return () => {
      window.clearTimeout(greet);
      reportSpan("imu.session", "end");
      dispatch({ type: "session_end" });
    };
  }, []);

  useEffect(() => {
    dispatch({ type: "set_input_mode", mode: inputMode });
  }, [inputMode]);

  useEffect(() => {
    if (gameEnded) dispatch({ type: "session_end" });
  }, [gameEnded]);

  useEffect(() => {
    return watchSensor(sensor, (event) => {
      try { dispatch(event); } catch { reportSidekickFailure(); }
    }, { getInputMode: () => inputModeRef.current, getEnded: () => endedRef.current });
  }, [sensor]);

  useEffect(() => {
    if (state.phase !== "recovering") return;
    const timer = window.setTimeout(() => dispatch({ type: "recovery_unresolved" }), 12_000);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    const from = prevPhase.current;
    const to = state.phase;
    prevPhase.current = to;
    breadcrumbTransition(from, to, state.source);
    if (to === "connecting") reportSpan("imu.connect", "start");
    if (to === "healthy") {
      reportSpan("imu.connect", "end");
      reportSpan("imu.healthy_session", "start");
    }
    if (to === "failure_detected") {
      reportSpan("imu.healthy_session", "end");
      try { onPause(); } catch { /* keep the game alive */ }
      if (!state.sentryDeferred) setPayload(reportFailure(state));
      dispatch({ type: "prompt_user" });
    }
    if (to === "recovering") reportSpan("imu.recovery", "start");
    if (to === "fallback_active") reportSpan("imu.fallback", "start");
    if (to === "recovered" || to === "unresolved") setPayload(reportRecovery(state) ?? payload);
  }, [state.phase]);

  const recover = (method: RecoveryMethod) => {
    setCalibratePending(false);
    dispatch({ type: "start_recovery", method });
    try {
      runRecovery(method, {
        pause: onPause,
        reconnect: onReconnect,
        sendCommand: onCalibrate,
        fallbackHandCam: () => {
          void Promise.resolve(onFallback()).then((ok) => {
            if (!ok) dispatch({ type: "fallback_failed" });
          });
        },
        exit: onExit
      });
    } catch {
      reportSidekickFailure();
    }
  };

  const onIntent = (intentional: boolean) => {
    if (!intentional) setPayload(reportFailure({ ...state, sentryDeferred: false }));
    dispatch({ type: "user_intent", intentional });
  };

  return (
    <SidekickBoundary>
      <SentrySidekick
        state={state}
        gameRunning={running}
        payload={payload}
        onDiagnosis={(choice) => {
          if (choice !== "intentionally_still" && state.sentryDeferred) setPayload(reportFailure({ ...state, sentryDeferred: false, diagnosis: choice }));
          dispatch({ type: "user_diagnosis", choice });
        }}
        onRecovery={recover}
        onConfirm={(choice) => dispatch({ type: "user_confirms", choice })}
        onIntent={onIntent}
        onCalibrateAsk={() => setCalibratePending(true)}
        calibratePending={calibratePending}
        onCalibrateConfirm={() => recover("calibrate")}
      />
    </SidekickBoundary>
  );
}
