"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Beety from "./PixelBuddy";
import { BEETY_INTRO, CONFIRM_LABELS, DIAGNOSIS_LABELS, copyFor, recoveryLabels } from "../../lib/rehab-guardian/copy";
import { receiptLines } from "../../lib/rehab-guardian/privacy";
import type { ConfirmationChoice, DiagnosisChoice, GuardianState, RecoveryMethod, SanitizedIncident } from "../../lib/rehab-guardian/types";
import { INCIDENT_PHASES } from "../../lib/rehab-guardian/types";
import "./sidekick.css";

type Props = {
  state: GuardianState;
  gameRunning: boolean;
  payload: SanitizedIncident | null;
  onDiagnosis: (choice: DiagnosisChoice) => void;
  onRecovery: (method: RecoveryMethod) => void;
  onConfirm: (choice: ConfirmationChoice) => void;
  onIntent: (intentional: boolean) => void;
  onCalibrateAsk: () => void;
  calibratePending: boolean;
  onCalibrateConfirm: () => void;
};

function line(text: string) {
  return `* ${text}`;
}

export default function SentrySidekick({
  state,
  gameRunning: _gameRunning,
  payload,
  onDiagnosis,
  onRecovery,
  onConfirm,
  onIntent,
  onCalibrateAsk,
  calibratePending,
  onCalibrateConfirm
}: Props) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || state.phase === "ended") return null;

  const incident = INCIDENT_PHASES.has(state.phase);
  if (!incident) {
    if (!state.greetingActive) return null;
    return createPortal(
      <aside className="sidekick-root sidekick-corner">
        <section className="sidekick-speech" role="status" aria-label="Beety the bug sensor helper">
          <p className="sidekick-intro">{BEETY_INTRO}</p>
        </section>
        <Beety mood="idle" />
      </aside>,
      document.body
    );
  }

  const copy = copyFor(state.phase, state.failureType);
  const mood = state.phase === "recovered" ? "ok" : "alert";
  const receipt = receiptLines(payload);
  const methods = recoveryLabels();
  const showIntent = state.phase === "awaiting_user" && state.promptKind === "intentional_disconnect";
  const showStillness = state.phase === "awaiting_user" && state.promptKind === "stillness";
  const showDiagnosis = state.phase === "awaiting_user" && state.promptKind === "diagnosis";
  const showRecovery = (state.phase === "awaiting_user" && state.promptKind === "recovery") || state.phase === "unresolved";
  const showConfirm = state.phase === "recovered" || (state.phase === "fallback_active" && state.promptKind === "confirm");

  return createPortal(
    <aside className="sidekick-root sidekick-incident">
      <div className="sidekick-tint" aria-hidden="true" />
      <div className="sidekick-stage" key={state.incidentId ?? state.phase}>
        <Beety mood={mood} />
        <section className="sidekick-panel" role="dialog" aria-label="Beety the bug sensor helper" aria-live="polite">
          <div className="sidekick-copy">
            <p className="sidekick-intro">{line(BEETY_INTRO)}</p>
            {copy.body ? <p>{line(copy.body)}</p> : null}
            {copy.question ? <p className="sidekick-question">{line(copy.question)}</p> : null}
          </div>
          {showIntent && (
            <div className="sidekick-actions" role="group" aria-label="Did you disconnect the sensor intentionally">
              <button type="button" onClick={() => onIntent(true)}>Yes</button>
              <button type="button" onClick={() => onIntent(false)}>No</button>
            </div>
          )}
          {showStillness && (
            <div className="sidekick-actions" role="group" aria-label="Were you holding still">
              <button type="button" onClick={() => onDiagnosis("intentionally_still")}>Yes, I was holding still</button>
              <button type="button" onClick={() => onDiagnosis("controls_stopped")}>No, something's wrong</button>
            </div>
          )}
          {showDiagnosis && (
            <div className="sidekick-actions" role="group" aria-label="What happened">
              {(Object.keys(DIAGNOSIS_LABELS) as DiagnosisChoice[]).map((choice) => (
                <button key={choice} type="button" onClick={() => onDiagnosis(choice)}>{DIAGNOSIS_LABELS[choice]}</button>
              ))}
            </div>
          )}
          {showRecovery && !calibratePending && (
            <div className="sidekick-actions" role="group" aria-label="Recovery actions">
              <button type="button" onClick={() => onRecovery("wait_for_frames")}>{methods.wait_for_frames}</button>
              <button type="button" onClick={() => onRecovery("reconnect")}>{methods.reconnect}</button>
              <button type="button" onClick={onCalibrateAsk}>{methods.calibrate}</button>
              <button type="button" onClick={() => onRecovery("hand_cam_fallback")}>{methods.hand_cam_fallback}</button>
              <button type="button" onClick={() => onRecovery("pause_and_exit")}>{methods.pause_and_exit}</button>
            </div>
          )}
          {calibratePending && (
            <div className="sidekick-confirm sidekick-actions">
              <p>{line("Send the existing “set center” calibration command?")}</p>
              <button type="button" onClick={onCalibrateConfirm}>Yes, set center</button>
              <button type="button" onClick={() => onRecovery("wait_for_frames")}>Not now</button>
            </div>
          )}
          {showConfirm && (
            <div className="sidekick-actions" role="group" aria-label="Did recovery work">
              {(Object.keys(CONFIRM_LABELS) as ConfirmationChoice[]).map((choice) => (
                <button key={choice} type="button" onClick={() => onConfirm(choice)}>{CONFIRM_LABELS[choice]}</button>
              ))}
            </div>
          )}
          {state.phase === "unresolved" && <p className="sidekick-kicker">{line("I'll stick around until this is sorted.")}</p>}
          {payload && (
            <details className="sidekick-receipt" open={receiptOpen} onToggle={(event) => setReceiptOpen((event.target as HTMLDetailsElement).open)}>
              <summary>What was reported?</summary>
              <p>Sentry received only:</p>
              <ul>{receipt.sent.map((lineText) => <li key={lineText}>{lineText}</li>)}</ul>
              <p>Not sent:</p>
              <ul>{receipt.never.map((lineText) => <li key={lineText}>{lineText}</li>)}</ul>
            </details>
          )}
        </section>
      </div>
    </aside>,
    document.body
  );
}
