import { z } from "zod";

export const EvidenceSchema = z.object({
  sourceId: z.string().min(1),
  snippet: z.string().min(1).max(500),
  page: z.number().int().positive().optional()
});

const claim = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceSchema)
  });

export const ExercisePlanSchema = z.object({
  id: z.string(),
  bodyPart: claim(z.string()),
  side: claim(z.enum(["left", "right", "bilateral", "not_applicable"])),
  movement: claim(z.string()),
  startingPosition: claim(z.string()),
  repetitions: claim(z.number().int().positive()),
  sets: claim(z.number().int().positive()),
  holdDurationSeconds: claim(z.number().nonnegative()),
  equipment: claim(z.array(z.string())),
  restrictions: claim(z.array(z.string())),
  compensationWarnings: claim(z.array(z.string())),
  frequency: claim(z.string()),
  conflicts: z.array(
    z.object({
      field: z.string(),
      values: z.array(z.string()).min(2),
      evidence: z.array(EvidenceSchema).min(2)
    })
  ),
  status: z.enum(["ready", "needs_clarification"]),
  clarificationQuestion: z.string().nullable()
});

export type ExercisePlan = z.infer<typeof ExercisePlanSchema>;

export const GameSpecSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string(),
    title: z.string(),
    template: z.enum(["arc_runner", "fruit_catcher", "sit_shapes"]),
    exercise: z.object({
      bodyPart: z.string(),
      side: z.enum(["left", "right", "bilateral", "not_applicable"]),
      movement: z.string(),
      startingPosition: z.string(),
      repetitions: z.number().int().positive().max(100),
      sets: z.number().int().positive().max(20),
      holdDurationSeconds: z.number().min(0).max(120),
      restrictions: z.array(z.string()),
      compensationWarnings: z.array(z.string())
    }),
    tracking: z.object({
      mode: z.enum(["pose", "hand", "pose_and_hardware"]),
      metric: z.enum([
        "shoulder_flexion",
        "shoulder_reach",
        "hand_closure",
        "seated_leg_lift"
      ]),
      confidenceThreshold: z.number().min(0.5).max(0.95),
      hardwareGripPreferred: z.boolean(),
      webcamMeasurementLabel: z.string()
    }),
    gameplay: z.object({
      targetCount: z.number().int().positive(),
      targetHoldMs: z.number().int().nonnegative(),
      pace: z.enum(["slow", "controlled", "therapist_defined"]),
      range: z.object({
        minimum: z.number().nullable(),
        maximum: z.number().nullable(),
        unit: z.enum(["degrees", "normalized", "closure_ratio"])
      })
    }),
    safety: z.object({
      launchAllowed: z.literal(true),
      neverScoreBelowConfidence: z.literal(true),
      doNotStoreRawVideo: z.literal(true),
      instructionsSource: z.literal("therapist_note"),
      warnings: z.array(z.string())
    })
  })
  .superRefine((spec, ctx) => {
    if (
      spec.gameplay.targetCount !==
      spec.exercise.repetitions * spec.exercise.sets
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["gameplay", "targetCount"],
        message: "Target count must equal repetitions × sets"
      });
    }
  });

export type GameSpec = z.infer<typeof GameSpecSchema>;

export const SessionSummarySchema = z.object({
  completedReps: z.number().int().nonnegative(),
  attemptedReps: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1),
  unscorableAttempts: z.number().int().nonnegative(),
  endedAt: z.string()
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export type TherapyAgentState = {
  sessionId: string;
  phase:
    | "intake"
    | "clarification"
    | "review"
    | "calibration"
    | "playing"
    | "paused"
    | "complete";
  plan: ExercisePlan | null;
  gameSpec: GameSpec | null;
  confidenceEvents: {
    at: string;
    confidence: number;
    action: "pause" | "unscorable" | "resume";
  }[];
  summary: SessionSummary | null;
};
