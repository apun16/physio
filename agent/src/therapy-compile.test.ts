import { describe, expect, it } from "vitest";
import {
  ensureNoTreatmentChanges,
  finalizeCompile,
  stepsFromPlan
} from "./therapy-compile";
import type { ExercisePlan, GameSpec } from "./therapy-schemas";

function claim<T>(value: T) {
  return {
    value,
    confidence: 0.95,
    evidence: [
      { sourceId: "demo", snippet: "Right shoulder flexion. 2 sets of 8." }
    ]
  };
}

const readyPlan = {
  id: "plan-1",
  bodyPart: claim("shoulder"),
  side: claim("right" as const),
  movement: claim("shoulder flexion"),
  startingPosition: claim("standing"),
  repetitions: claim(8),
  sets: claim(2),
  holdDurationSeconds: claim(0),
  equipment: claim([] as string[]),
  restrictions: claim(["No overhead reaching"]),
  compensationWarnings: claim(["Avoid trunk lean"]),
  frequency: claim(null),
  conflicts: [],
  status: "ready" as const,
  clarificationQuestion: null
} satisfies ExercisePlan;

const spec = {
  version: 1 as const,
  sessionId: "session-1",
  title: "Arc Runner",
  template: "arc_runner" as const,
  exercise: {
    bodyPart: "shoulder",
    side: "right" as const,
    movement: "shoulder flexion",
    startingPosition: "standing",
    repetitions: 8,
    sets: 2,
    holdDurationSeconds: 0,
    restrictions: ["No overhead reaching"],
    compensationWarnings: ["Avoid trunk lean"]
  },
  tracking: {
    mode: "pose" as const,
    metric: "shoulder_flexion" as const,
    confidenceThreshold: 0.55,
    hardwareGripPreferred: false,
    webcamMeasurementLabel: "Right shoulder and wrist elevation"
  },
  gameplay: {
    targetCount: 16,
    targetHoldMs: 0,
    pace: "therapist_defined" as const,
    range: { minimum: null, maximum: null, unit: "normalized" as const }
  },
  safety: {
    launchAllowed: true as const,
    neverScoreBelowConfidence: true as const,
    doNotStoreRawVideo: true as const,
    instructionsSource: "therapist_note" as const,
    warnings: ["Avoid trunk lean", "No overhead reaching"]
  }
} satisfies GameSpec;

describe("TherapyGameAgent compile contract", () => {
  it("structured compile accepts a ready shoulder plan and Arc Runner spec", () => {
    const result = finalizeCompile(readyPlan, spec);
    expect(result.plan.status).toBe("ready");
    expect(result.gameSpec?.template).toBe("arc_runner");
    expect(result.gameSpec?.gameplay.targetCount).toBe(16);
    expect(result.steps.at(-1)?.tool).toBe("generate_game_spec");
  });

  it("GameSpec cannot change therapist repetitions or sets", () => {
    expect(() =>
      ensureNoTreatmentChanges(readyPlan, {
        ...spec,
        exercise: { ...spec.exercise, repetitions: 12 },
        gameplay: { ...spec.gameplay, targetCount: 24 }
      })
    ).toThrow(/repetitions or sets/);
  });

  it("clarification notes do not emit a GameSpec", () => {
    const result = finalizeCompile(
      {
        ...readyPlan,
        status: "needs_clarification",
        clarificationQuestion: "How many sets did your therapist prescribe?"
      },
      spec
    );
    expect(result.gameSpec).toBeNull();
    expect(result.steps.at(-1)?.tool).toBe("ask_clarification");
  });

  it("agent trace names the compiler tools", () => {
    expect(stepsFromPlan(readyPlan, spec).map((step) => step.tool)).toEqual([
      "extract_exercise_claims",
      "find_conflicts",
      "validate_plan",
      "generate_game_spec"
    ]);
  });
});
