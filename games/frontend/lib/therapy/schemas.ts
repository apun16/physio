import { z } from "zod";

export const EvidenceSchema = z.object({
  sourceId: z.string().min(1),
  snippet: z.string().min(1).max(500),
  page: z.number().int().positive().optional()
});

export const claimSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceSchema)
  });

export const ExercisePlanSchema = z.object({
  id: z.string().min(1),
  bodyPart: claimSchema(z.string()),
  side: claimSchema(z.enum(["left", "right", "bilateral", "not_applicable"])),
  movement: claimSchema(z.string()),
  startingPosition: claimSchema(z.string()),
  repetitions: claimSchema(z.number().int().positive()),
  sets: claimSchema(z.number().int().positive()),
  holdDurationSeconds: claimSchema(z.number().nonnegative()),
  equipment: claimSchema(z.array(z.string())),
  restrictions: claimSchema(z.array(z.string())),
  compensationWarnings: claimSchema(z.array(z.string())),
  frequency: claimSchema(z.string()),
  conflicts: z.array(z.object({
    field: z.string(),
    values: z.array(z.string()).min(2),
    evidence: z.array(EvidenceSchema).min(2)
  })),
  status: z.enum(["ready", "needs_clarification"]),
  clarificationQuestion: z.string().nullable()
});

export type ExercisePlan = z.infer<typeof ExercisePlanSchema>;

export const GameSpecSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  title: z.string().min(1).max(80),
  template: z.enum(["arc_runner", "fruit_catcher", "sit_shapes"]),
  exercise: z.object({
    bodyPart: z.string().min(1),
    side: z.enum(["left", "right", "bilateral", "not_applicable"]),
    movement: z.string().min(1),
    startingPosition: z.string().min(1),
    repetitions: z.number().int().positive().max(100),
    sets: z.number().int().positive().max(20),
    holdDurationSeconds: z.number().min(0).max(120),
    restrictions: z.array(z.string()),
    compensationWarnings: z.array(z.string())
  }),
  tracking: z.object({
    mode: z.enum(["pose", "hand", "pose_and_hardware"]),
    metric: z.enum(["shoulder_flexion", "shoulder_reach", "hand_closure", "seated_leg_lift"]),
    confidenceThreshold: z.number().min(0.5).max(0.95),
    hardwareGripPreferred: z.boolean(),
    webcamMeasurementLabel: z.string().min(1)
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
    neverScoreBelowConfidence: z.boolean(),
    doNotStoreRawVideo: z.boolean(),
    instructionsSource: z.literal("therapist_note"),
    warnings: z.array(z.string())
  })
}).superRefine((spec, ctx) => {
  if (spec.gameplay.targetCount !== spec.exercise.repetitions * spec.exercise.sets) {
    ctx.addIssue({
      code: "custom",
      path: ["gameplay", "targetCount"],
      message: "Target count must exactly match therapist-provided repetitions × sets"
    });
  }
  if (!spec.safety.neverScoreBelowConfidence || !spec.safety.doNotStoreRawVideo) {
    ctx.addIssue({
      code: "custom",
      path: ["safety"],
      message: "Camera confidence gating and local-only video are required"
    });
  }
  if (spec.template === "fruit_catcher" && spec.tracking.metric !== "hand_closure") {
    ctx.addIssue({ code: "custom", path: ["tracking", "metric"], message: "Fruit Catcher requires hand-closure tracking" });
  }
  if (spec.template === "sit_shapes" && spec.tracking.metric !== "seated_leg_lift") {
    ctx.addIssue({ code: "custom", path: ["tracking", "metric"], message: "Sit Shapes requires seated leg-lift tracking" });
  }
});

export type GameSpec = z.infer<typeof GameSpecSchema>;

export const AgentStepSchema = z.object({
  tool: z.enum(["extract_exercise_claims", "find_conflicts", "validate_plan", "ask_clarification", "generate_game_spec"]),
  status: z.enum(["ok", "blocked"]),
  detail: z.string().min(1)
});

export type AgentStep = z.infer<typeof AgentStepSchema>;

export const TherapySessionStateSchema = z.object({
  sessionId: z.string(),
  phase: z.enum(["intake", "clarification", "review", "calibration", "playing", "paused", "complete"]),
  plan: ExercisePlanSchema.nullable(),
  gameSpec: GameSpecSchema.nullable(),
  confidenceEvents: z.array(z.object({
    at: z.string(),
    confidence: z.number().min(0).max(1),
    action: z.enum(["pause", "unscorable", "resume"])
  })),
  summary: z.object({
    completedReps: z.number().int().nonnegative(),
    attemptedReps: z.number().int().nonnegative(),
    averageConfidence: z.number().min(0).max(1)
  }).nullable()
});

export type TherapySessionState = z.infer<typeof TherapySessionStateSchema>;
