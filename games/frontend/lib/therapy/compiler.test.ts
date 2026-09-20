import { describe, expect, it } from "vitest";
import { compileWithLocalTools } from "./agent-compile";
import { extractExercisePlan, generateGameSpec, validateGameSpecAgainstPlan } from "./compiler";
import { therapyNoteFixtures } from "./fixtures";
import { GameSpecSchema } from "./schemas";

describe("therapy note conflict detection", () => {
  it("blocks a note with conflicting repetition counts", () => {
    const plan = extractExercisePlan(therapyNoteFixtures[1].text);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.conflicts[0]).toMatchObject({
      field: "repetitions",
      values: expect.arrayContaining(["10", "8"])
    });
    expect(plan.clarificationQuestion).toMatch(/10/);
    expect(plan.clarificationQuestion).toMatch(/8/);
    expect(() => generateGameSpec(plan)).toThrow(/clarification/i);
  });

  it("does not invent missing instructions", () => {
    const plan = extractExercisePlan(therapyNoteFixtures[2].text);
    expect(plan.bodyPart.value).toBe("shoulder");
    expect(plan.side.value).toBeNull();
    expect(plan.repetitions.value).toBeNull();
    expect(plan.sets.value).toBeNull();
    expect(plan.status).toBe("needs_clarification");
    expect(plan.clarificationQuestion).toMatch(/side|repetition/i);
    expect(() => generateGameSpec(plan)).toThrow(/clarification/i);
  });

  it("resolves a conflict only from a therapist-supplied answer", () => {
    const resolved = extractExercisePlan(
      `${therapyNoteFixtures[1].text}\nClarification question: Your note lists 10 and 8 repetitions. Which number did your therapist intend?\nPatient answer: 8 reps`
    );
    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.repetitions.value).toBe(8);
  });
});

describe("GameSpec validation", () => {
  const plan = extractExercisePlan(therapyNoteFixtures[0].text);

  it("creates a constrained Arc Runner spec from a clear shoulder note", () => {
    expect(plan.status).toBe("ready");
    const spec = generateGameSpec(plan, "test-session");
    expect(GameSpecSchema.parse(spec).template).toBe("arc_runner");
    expect(spec.exercise.repetitions).toBe(8);
    expect(spec.exercise.sets).toBe(2);
    expect(spec.gameplay.targetCount).toBe(16);
    expect(spec.safety.neverScoreBelowConfidence).toBe(true);
    expect(spec.safety.doNotStoreRawVideo).toBe(true);
    expect(spec.safety.warnings.some((warning) => /trunk lean/i.test(warning))).toBe(true);
  });

  it("creates Fruit Catcher only after hand dosage is explicit", () => {
    const incomplete = extractExercisePlan(therapyNoteFixtures[3].text);
    expect(incomplete.status).toBe("needs_clarification");
    expect(incomplete.holdDurationSeconds.value).toBe(3);
    expect(() => generateGameSpec(incomplete)).toThrow(/clarification/i);

    const ready = extractExercisePlan(
      `${therapyNoteFixtures[3].text}\nClarification question: How many sets did your therapist prescribe?\nPatient answer: 1 set\nClarification question: Which hand did your therapist ask you to use?\nPatient answer: right hand`
    );
    expect(ready.status).toBe("ready");
    const spec = generateGameSpec(ready, "hand-session");
    expect(spec.template).toBe("fruit_catcher");
    expect(spec.tracking.metric).toBe("hand_closure");
    expect(spec.tracking.webcamMeasurementLabel).toMatch(/hand-closure tracking/i);
    expect(spec.gameplay.targetCount).toBe(10);
    expect(spec.gameplay.targetHoldMs).toBe(3000);
  });

  it("rejects increased repetitions", () => {
    const spec = generateGameSpec(plan, "test-session");
    const changed = { ...spec, exercise: { ...spec.exercise, repetitions: 12 }, gameplay: { ...spec.gameplay, targetCount: 24 } };
    expect(() => validateGameSpecAgainstPlan(plan, changed)).toThrow(/cannot change/i);
  });

  it("rejects a mismatched target count", () => {
    const spec = generateGameSpec(plan, "test-session");
    expect(() => GameSpecSchema.parse({ ...spec, gameplay: { ...spec.gameplay, targetCount: 99 } })).toThrow(/target count/i);
  });

  it("creates Sit Shapes from a seated leg note", () => {
    const seated = extractExercisePlan(therapyNoteFixtures[4].text);
    expect(seated.status).toBe("ready");
    expect(seated.bodyPart.value).toBe("legs");
    const spec = generateGameSpec(seated, "leg-session");
    expect(spec.template).toBe("sit_shapes");
    expect(spec.tracking.metric).toBe("seated_leg_lift");
    expect(spec.gameplay.targetCount).toBe(12);
    expect(spec.tracking.webcamMeasurementLabel).toMatch(/seated leg/i);
  });
});

describe("Rox tool loop", () => {
  it("exposes extract, conflict, validate, and generate steps", () => {
    const result = compileWithLocalTools(therapyNoteFixtures[0].text);
    expect(result.provider).toBe("rox-tool-loop");
    expect(result.steps.map((step) => step.tool)).toEqual([
      "extract_exercise_claims",
      "find_conflicts",
      "validate_plan",
      "generate_game_spec"
    ]);
    expect(result.steps.every((step) => step.status === "ok")).toBe(true);
    expect(result.gameSpec?.template).toBe("arc_runner");
  });

  it("stops at ask_clarification when the note conflicts", () => {
    const result = compileWithLocalTools(therapyNoteFixtures[1].text);
    expect(result.gameSpec).toBeNull();
    expect(result.steps.at(-1)).toMatchObject({ tool: "ask_clarification", status: "blocked" });
  });
});
