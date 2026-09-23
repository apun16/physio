"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { therapyNoteFixtures } from "../../lib/therapy/fixtures";
import { AgentStepSchema, ExercisePlanSchema, GameSpecSchema, type AgentStep, type ExercisePlan, type GameSpec } from "../../lib/therapy/schemas";
import styles from "./therapy.module.css";

type Result = { sessionId: string; plan: ExercisePlan; gameSpec: GameSpec | null; provider?: string; steps?: AgentStep[] };

const claimRows: [keyof ExercisePlan, string][] = [
  ["bodyPart", "Body part"],
  ["side", "Side"],
  ["movement", "Movement"],
  ["startingPosition", "Starting position"],
  ["repetitions", "Repetitions"],
  ["sets", "Sets"],
  ["holdDurationSeconds", "Hold duration"],
  ["equipment", "Equipment"],
  ["restrictions", "Restrictions"],
  ["compensationWarnings", "Compensation warnings"]
];

function displayValue(value: unknown, key: keyof ExercisePlan) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return "Not stated";
  if (key === "holdDurationSeconds") return `${value} seconds`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value).replaceAll("_", " ");
}

export default function TherapyCompiler() {
  const router = useRouter();
  const [text, setText] = useState(therapyNoteFixtures[0]?.text ?? "");
  const [source, setSource] = useState(therapyNoteFixtures[0]?.metadata ?? { fileName: "pasted-note.txt", mimeType: "text/plain", note: "Pasted by patient" });
  const [stage, setStage] = useState<"intake" | "working" | "review">("intake");
  const [progress, setProgress] = useState({ stage: "", progress: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  async function compile(noteText = text, metadata = source, sessionId?: string) {
    if (!noteText.trim()) {
      setError("Paste a therapy note or choose a demo first.");
      return;
    }
    setError("");
    setStage("working");
    setProgress({ stage: "extract_exercise_claims → find_conflicts → validate_plan", progress: 0.42 });
    try {
      const response = await fetch("/api/therapy/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: noteText, metadata, sessionId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The therapy agent could not read this note.");
      const parsed: Result = {
        sessionId: String(payload.sessionId),
        plan: ExercisePlanSchema.parse(payload.plan),
        gameSpec: payload.gameSpec ? GameSpecSchema.parse(payload.gameSpec) : null,
        provider: payload.provider,
        steps: Array.isArray(payload.steps)
          ? payload.steps.flatMap((step: unknown) => {
              const parsed = AgentStepSchema.safeParse(step);
              return parsed.success ? [parsed.data] : [];
            })
          : []
      };
      setResult(parsed);
      setStage("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Compilation failed.");
      setStage("intake");
    }
  }

  async function answerClarification() {
    if (!answer.trim() || !result?.plan.clarificationQuestion) return;
    const nextText = `${text}\nClarification question: ${result.plan.clarificationQuestion}\nPatient answer: ${answer.trim()}`;
    setText(nextText);
    setAnswer("");
    await compile(nextText, source, result.sessionId);
  }

  function useFixture(index: number) {
    const fixture = therapyNoteFixtures[index];
    setText(fixture.text);
    setSource(fixture.metadata);
    setResult(null);
    setError("");
    void compile(fixture.text, fixture.metadata);
  }

  function launchGame() {
    if (!result?.gameSpec) return;
    try {
      sessionStorage.setItem("therapy-game-spec", JSON.stringify(result.gameSpec));
      sessionStorage.setItem("therapy-agent-session", result.sessionId);
    } catch {
      /* launch still works with the play-page demo spec if storage is blocked */
    }
    router.push("/therapy/play");
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard"><ArrowLeft size={15} /> DASHBOARD</Link>
        <div><span className="pixel-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span><b>THERAPY COMPILER</b></div>
        <span><LockKeyhole size={13} /> LOCAL CAMERA</span>
      </header>

      <section className={styles.hero}>
        <span>WE // PATIENT MODE</span>
        <h1>TURN YOUR THERAPY NOTE<br /><b>INTO A GAME</b></h1>
        <p>Upload the instructions from your therapist. We will organize them, ask about anything unclear, and build a camera-controlled game without changing your treatment.</p>
      </section>

      {stage === "intake" && (
        <section className={styles.compiler}>
          <div className={styles.intake}>
            <div className={styles.sectionTitle}><span>01</span><div><small>ADD INSTRUCTIONS</small><h2>Your therapy note</h2></div></div>
            <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Right shoulder flexion. 2 sets of 8. Avoid trunk lean. No overhead reaching." />
            <button type="button" className={styles.primary} onClick={() => void compile()}>CHECK MY NOTE <ArrowRight size={15} /></button>
            {error && <p className={styles.error}><AlertTriangle size={15} />{error}</p>}
            <div className={styles.or}><i />OR UPLOAD A FILE LATER<i /></div>
            <p className={styles.uploadHint}>Paste the therapist note first. PDF and photo upload can be added after this compiler path is working.</p>
          </div>

          <aside className={styles.demo}>
            <div className={styles.sectionTitle}><span>DEMO</span><div><small>SYNTHETIC NOTES</small><h2>Try an example</h2></div></div>
            {therapyNoteFixtures.map((fixture, index) => (
              <button key={fixture.id} onClick={() => useFixture(index)}>
                <FileText size={18} />
                <span><b>{fixture.label}</b><small>{fixture.text}</small></span>
                <ArrowRight size={14} />
              </button>
            ))}
            <p><ShieldCheck size={16} />These examples are fictional and contain no patient data.</p>
          </aside>
        </section>
      )}

      {stage === "working" && (
        <section className={styles.working}>
          <div><LoaderCircle size={34} /><i style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
          <span>WE ARE READING YOUR NOTE</span>
          <h2>{progress.stage || "Calling compiler tools"}</h2>
          <p>extract_exercise_claims, find_conflicts, validate_plan, then ask_clarification or generate_game_spec. Medical instructions are never filled in by guesswork.</p>
        </section>
      )}

      {stage === "review" && result && (
        <section className={styles.review}>
          <div className={styles.reviewTop}>
            <div className={styles.sectionTitle}><span>02</span><div><small>REVIEW</small><h2>What we found</h2></div></div>
            <button onClick={() => { setStage("intake"); setResult(null); }}><ArrowLeft size={14} /> USE ANOTHER NOTE</button>
          </div>

          {result.steps && result.steps.length > 0 && (
            <div className={styles.trace}>
              <div>
                <span>AGENT TRACE</span>
                <b>{result.provider ?? "local-safe-demo"} · {result.sessionId.slice(0, 8)}</b>
              </div>
              <ol>
                {result.steps.map((step, index) => (
                  <li key={`${step.tool}-${index}`}>
                    <em>0{index + 1}</em>
                    <div>
                      <b>{step.tool}</b>
                      <p>{step.detail}</p>
                    </div>
                    <small className={step.status === "ok" ? styles.ok : styles.blocked}>{step.status.toUpperCase()}</small>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {result.plan.status === "needs_clarification" ? (
            <div className={styles.clarification}>
              <AlertTriangle size={23} />
              <div><span>NEEDS CLARIFICATION</span><h2>{result.plan.clarificationQuestion}</h2><p>We will not create a game until the therapist’s instruction is clear.</p></div>
              <div><input value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void answerClarification(); }} placeholder="Type the therapist-provided answer" /><button onClick={() => void answerClarification()}>SUBMIT <ArrowRight size={14} /></button></div>
            </div>
          ) : (
            <div className={styles.ready}><Check size={16} /><span>PLAN READY</span><p>No conflicting required instructions were found.</p></div>
          )}

          <div className={styles.claims}>
            {claimRows.map(([key, label]) => {
              const item = result.plan[key] as { value: unknown; confidence: number; evidence: { snippet: string }[] };
              return (
                <article key={key}>
                  <div><span>{label}</span><small>{Math.round(item.confidence * 100)}% CONFIDENCE</small></div>
                  <b>{displayValue(item.value, key)}</b>
                  {item.evidence[0] && <p>“{item.evidence[0].snippet}”</p>}
                </article>
              );
            })}
          </div>

          {result.gameSpec && (
            <div className={styles.gameReady}>
              <div>
                <Sparkles size={22} />
                <span>
                  <small>GENERATED GAME PLAN</small>
                  <b>{result.gameSpec.title}</b>
                  <p>{result.gameSpec.template.replaceAll("_", " ")} · {result.gameSpec.tracking.webcamMeasurementLabel}</p>
                  <p>{result.gameSpec.gameplay.targetCount} targets · {result.gameSpec.exercise.repetitions} reps × {result.gameSpec.exercise.sets} sets · confidence floor {Math.round(result.gameSpec.tracking.confidenceThreshold * 100)}%</p>
                </span>
              </div>
              <button type="button" onClick={launchGame}>CREATE MY GAME <Camera size={16} /></button>
            </div>
          )}
        </section>
      )}

      <footer className={styles.footer}><ShieldCheck size={14} /> We transform therapist instructions into gameplay. We do not diagnose, prescribe, or change treatment.</footer>
    </main>
  );
}
