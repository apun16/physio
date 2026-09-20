import OpenAI from "openai";
import {
  ExercisePlanSchema,
  GameSpecSchema,
  type ExercisePlan,
  type GameSpec
} from "./therapy-schemas";

export type AgentStep = {
  tool: string;
  status: "ok" | "blocked";
  detail: string;
};

export type CompilePayload = {
  plan: ExercisePlan;
  gameSpec: GameSpec | null;
  steps: AgentStep[];
};

export const THERAPY_SYSTEM = `You are TherapyGameAgent, a safety-constrained compiler for therapist-authored exercise notes.
You transform instructions; you never diagnose, prescribe, increase range/repetitions/sets, or fill medical gaps.
Every claim must include an exact source snippet and confidence. Conflicts or missing required details must produce one patient-friendly clarification question and no GameSpec.
Return JSON with plan (ExercisePlan) and gameSpec (GameSpec or null).
Game generation is limited to arc_runner and fruit_catcher. Shoulder flexion maps to arc_runner. Hand notes map to fruit_catcher. Do not generate a GameSpec for seated or leg notes; ask one clarification that this compiler currently supports shoulder and hand notes.
Webcam hand input is hand-closure tracking, never grip-strength measurement. Raw camera video is never uploaded or stored.
If the plan is ready, GameSpec.gameplay.targetCount MUST equal repetitions × sets.`;

const evidenceItem = {
  type: "object" as const,
  additionalProperties: false,
  required: ["sourceId", "snippet"],
  properties: {
    sourceId: { type: "string" },
    snippet: { type: "string" }
  }
};

const claimSchema = (value: Record<string, unknown>) => ({
  type: "object" as const,
  additionalProperties: false,
  required: ["value", "confidence", "evidence"],
  properties: {
    value: { anyOf: [value, { type: "null" }] },
    confidence: { type: "number" },
    evidence: { type: "array", items: evidenceItem }
  }
});

const exercisePlanJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "id",
    "bodyPart",
    "side",
    "movement",
    "startingPosition",
    "repetitions",
    "sets",
    "holdDurationSeconds",
    "equipment",
    "restrictions",
    "compensationWarnings",
    "frequency",
    "conflicts",
    "status",
    "clarificationQuestion"
  ],
  properties: {
    id: { type: "string" },
    bodyPart: claimSchema({ type: "string" }),
    side: claimSchema({
      type: "string",
      enum: ["left", "right", "bilateral", "not_applicable"]
    }),
    movement: claimSchema({ type: "string" }),
    startingPosition: claimSchema({ type: "string" }),
    repetitions: claimSchema({ type: "integer" }),
    sets: claimSchema({ type: "integer" }),
    holdDurationSeconds: claimSchema({ type: "number" }),
    equipment: claimSchema({ type: "array", items: { type: "string" } }),
    restrictions: claimSchema({ type: "array", items: { type: "string" } }),
    compensationWarnings: claimSchema({
      type: "array",
      items: { type: "string" }
    }),
    frequency: claimSchema({ type: "string" }),
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "values", "evidence"],
        properties: {
          field: { type: "string" },
          values: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: evidenceItem }
        }
      }
    },
    status: { type: "string", enum: ["ready", "needs_clarification"] },
    clarificationQuestion: { anyOf: [{ type: "string" }, { type: "null" }] }
  }
};

const gameSpecJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "version",
    "sessionId",
    "title",
    "template",
    "exercise",
    "tracking",
    "gameplay",
    "safety"
  ],
  properties: {
    version: { type: "integer", enum: [1] },
    sessionId: { type: "string" },
    title: { type: "string" },
    template: {
      type: "string",
      enum: ["arc_runner", "fruit_catcher"]
    },
    exercise: {
      type: "object",
      additionalProperties: false,
      required: [
        "bodyPart",
        "side",
        "movement",
        "startingPosition",
        "repetitions",
        "sets",
        "holdDurationSeconds",
        "restrictions",
        "compensationWarnings"
      ],
      properties: {
        bodyPart: { type: "string" },
        side: {
          type: "string",
          enum: ["left", "right", "bilateral", "not_applicable"]
        },
        movement: { type: "string" },
        startingPosition: { type: "string" },
        repetitions: { type: "integer" },
        sets: { type: "integer" },
        holdDurationSeconds: { type: "number" },
        restrictions: { type: "array", items: { type: "string" } },
        compensationWarnings: { type: "array", items: { type: "string" } }
      }
    },
    tracking: {
      type: "object",
      additionalProperties: false,
      required: [
        "mode",
        "metric",
        "confidenceThreshold",
        "hardwareGripPreferred",
        "webcamMeasurementLabel"
      ],
      properties: {
        mode: { type: "string", enum: ["pose", "hand", "pose_and_hardware"] },
        metric: {
          type: "string",
          enum: [
            "shoulder_flexion",
            "shoulder_reach",
            "hand_closure"
          ]
        },
        confidenceThreshold: { type: "number" },
        hardwareGripPreferred: { type: "boolean" },
        webcamMeasurementLabel: { type: "string" }
      }
    },
    gameplay: {
      type: "object",
      additionalProperties: false,
      required: ["targetCount", "targetHoldMs", "pace", "range"],
      properties: {
        targetCount: { type: "integer" },
        targetHoldMs: { type: "integer" },
        pace: { type: "string", enum: ["slow", "controlled", "therapist_defined"] },
        range: {
          type: "object",
          additionalProperties: false,
          required: ["minimum", "maximum", "unit"],
          properties: {
            minimum: { anyOf: [{ type: "number" }, { type: "null" }] },
            maximum: { anyOf: [{ type: "number" }, { type: "null" }] },
            unit: {
              type: "string",
              enum: ["degrees", "normalized", "closure_ratio"]
            }
          }
        }
      }
    },
    safety: {
      type: "object",
      additionalProperties: false,
      required: [
        "launchAllowed",
        "neverScoreBelowConfidence",
        "doNotStoreRawVideo",
        "instructionsSource",
        "warnings"
      ],
      properties: {
        launchAllowed: { type: "boolean", enum: [true] },
        neverScoreBelowConfidence: { type: "boolean", enum: [true] },
        doNotStoreRawVideo: { type: "boolean", enum: [true] },
        instructionsSource: { type: "string", enum: ["therapist_note"] },
        warnings: { type: "array", items: { type: "string" } }
      }
    }
  }
};

const compileResultJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["plan", "gameSpec"],
  properties: {
    plan: exercisePlanJsonSchema,
    gameSpec: { anyOf: [gameSpecJsonSchema, { type: "null" }] }
  }
};

const planToolParameters = {
  type: "object" as const,
  additionalProperties: false,
  required: ["plan"],
  properties: { plan: exercisePlanJsonSchema }
};

const functionTools: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "extract_exercise_claims",
    description:
      "Return all exercise claims with source evidence and confidence. Null means not stated.",
    strict: true,
    parameters: planToolParameters
  },
  {
    type: "function",
    name: "find_conflicts",
    description: "Identify conflicting values and cite both source snippets.",
    strict: true,
    parameters: planToolParameters
  },
  {
    type: "function",
    name: "validate_plan",
    description:
      "Validate that required instructions are explicit and no instruction was invented.",
    strict: true,
    parameters: planToolParameters
  },
  {
    type: "function",
    name: "ask_clarification",
    description:
      "Ask exactly one plain-language question when required instructions conflict or are absent.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "question"],
      properties: {
        plan: exercisePlanJsonSchema,
        question: { type: "string" }
      }
    }
  },
  {
    type: "function",
    name: "generate_game_spec",
    description:
      "Create a constrained GameSpec only from a fully validated ExercisePlan.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "gameSpec"],
      properties: {
        plan: exercisePlanJsonSchema,
        gameSpec: gameSpecJsonSchema
      }
    }
  }
];

export function ensureNoTreatmentChanges(plan: ExercisePlan, spec: GameSpec) {
  if (
    spec.exercise.repetitions !== plan.repetitions.value ||
    spec.exercise.sets !== plan.sets.value
  ) {
    throw new Error("GameSpec changed therapist-provided repetitions or sets");
  }
  if (
    spec.gameplay.targetCount !==
    spec.exercise.repetitions * spec.exercise.sets
  ) {
    throw new Error("Target count does not match the exercise plan");
  }
}

export function stepsFromPlan(
  plan: ExercisePlan,
  gameSpec: GameSpec | null
): AgentStep[] {
  const extracted = plan.bodyPart.value
    ? `Extracted ${plan.bodyPart.value}${plan.movement.value ? ` / ${plan.movement.value}` : ""}`
    : "No body part or movement was stated";
  const conflict = plan.conflicts[0];
  return [
    { tool: "extract_exercise_claims", status: "ok", detail: extracted },
    {
      tool: "find_conflicts",
      status: conflict ? "blocked" : "ok",
      detail: conflict
        ? `Conflicting ${conflict.field}: ${conflict.values.join(" vs ")}`
        : "No conflicting required instructions"
    },
    {
      tool: "validate_plan",
      status: plan.status === "ready" ? "ok" : "blocked",
      detail:
        plan.status === "ready"
          ? "Required fields are explicit and sourced"
          : (plan.clarificationQuestion ?? "Needs clarification")
    },
    plan.status === "ready" && gameSpec
      ? {
          tool: "generate_game_spec",
          status: "ok",
          detail: `${gameSpec.title} · ${gameSpec.gameplay.targetCount} therapist-defined targets`
        }
      : {
          tool: "ask_clarification",
          status: "blocked",
          detail: plan.clarificationQuestion ?? "Ask one clarifying question"
        }
  ];
}

export function finalizeCompile(
  rawPlan: unknown,
  rawSpec: unknown
): CompilePayload {
  const plan = ExercisePlanSchema.parse(rawPlan);
  const gameSpec =
    rawSpec && plan.status === "ready" && plan.conflicts.length === 0
      ? GameSpecSchema.parse(rawSpec)
      : null;
  if (gameSpec) ensureNoTreatmentChanges(plan, gameSpec);
  return {
    plan,
    gameSpec: plan.status === "ready" ? gameSpec : null,
    steps: stepsFromPlan(plan, plan.status === "ready" ? gameSpec : null)
  };
}

export async function compileWithStructuredOutput(
  client: OpenAI,
  model: string,
  text: string,
  metadata: Record<string, unknown>
): Promise<CompilePayload> {
  const response = await client.responses.create({
    model,
    instructions: THERAPY_SYSTEM,
    input: JSON.stringify({ extractedText: text, metadata }),
    text: {
      format: {
        type: "json_schema",
        name: "therapy_compile",
        strict: true,
        schema: compileResultJsonSchema
      }
    }
  });
  const parsed = JSON.parse(response.output_text || "{}") as {
    plan?: unknown;
    gameSpec?: unknown;
  };
  return finalizeCompile(parsed.plan, parsed.gameSpec);
}

export async function compileWithTools(
  client: OpenAI,
  model: string,
  text: string,
  metadata: Record<string, unknown>
): Promise<CompilePayload> {
  let response = await client.responses.create({
    model,
    instructions: THERAPY_SYSTEM,
    input: JSON.stringify({ extractedText: text, metadata }),
    tools: functionTools,
    tool_choice: "required",
    parallel_tool_calls: false
  });
  let plan: ExercisePlan | null = null;
  let gameSpec: GameSpec | null = null;
  const steps: AgentStep[] = [];

  for (let step = 0; step < 8; step++) {
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
        item.type === "function_call"
    );
    if (!calls.length) break;
    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = [];
    for (const call of calls) {
      const args = JSON.parse(call.arguments) as Record<string, unknown>;
      let output: unknown = { ok: true };
      if (call.name === "generate_game_spec") {
        const compiled = finalizeCompile(args.plan, args.gameSpec);
        plan = compiled.plan;
        gameSpec = compiled.gameSpec;
        steps.push(...compiled.steps.slice(-1));
        output = { ok: true, plan, gameSpec };
      } else {
        plan = ExercisePlanSchema.parse(args.plan);
        if (
          call.name === "ask_clarification" &&
          typeof args.question === "string"
        ) {
          plan = ExercisePlanSchema.parse({
            ...plan,
            status: "needs_clarification",
            clarificationQuestion: args.question
          });
        }
        steps.push({
          tool: call.name,
          status:
            call.name === "ask_clarification" || plan.status !== "ready"
              ? "blocked"
              : "ok",
          detail:
            call.name === "ask_clarification"
              ? (plan.clarificationQuestion ?? "Clarification required")
              : (plan.bodyPart.value ?? "Claims extracted")
        });
        output = { ok: true, plan };
      }
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output)
      });
    }
    if (gameSpec || plan?.status === "needs_clarification") break;
    response = await client.responses.create({
      model,
      instructions: THERAPY_SYSTEM,
      previous_response_id: response.id,
      input: outputs,
      tools: functionTools,
      tool_choice: "required",
      parallel_tool_calls: false
    });
  }
  if (!plan) throw new Error("Agent did not return a valid ExercisePlan");
  return {
    plan,
    gameSpec: plan.status === "ready" ? gameSpec : null,
    steps: steps.length ? steps : stepsFromPlan(plan, gameSpec)
  };
}

export async function compileTherapyNote(
  client: OpenAI,
  model: string,
  text: string,
  metadata: Record<string, unknown>
): Promise<CompilePayload> {
  try {
    return await compileWithStructuredOutput(client, model, text, metadata);
  } catch {
    return compileWithTools(client, model, text, metadata);
  }
}
