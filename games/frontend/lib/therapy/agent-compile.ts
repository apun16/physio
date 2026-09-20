import OpenAI from "openai";
import { extractExercisePlan, generateGameSpec } from "./compiler";
import { ExercisePlanSchema, GameSpecSchema, type AgentStep, type ExercisePlan, type GameSpec } from "./schemas";

export type { AgentStep };

export type CompileResult = {
  sessionId: string;
  plan: ExercisePlan;
  gameSpec: GameSpec | null;
  provider: string;
  steps: AgentStep[];
};

const SYSTEM = `You are TherapyGameAgent, a safety-constrained compiler for therapist-authored exercise notes.
You transform instructions; you never diagnose, prescribe, increase range/repetitions/sets, or fill medical gaps.
Every claim must include an exact source snippet and confidence. Conflicts or missing required details must produce one patient-friendly clarification question and no GameSpec.
Use the tools in order: extract_exercise_claims, find_conflicts, validate_plan, then ask_clarification OR generate_game_spec.
Game generation is limited to arc_runner, fruit_catcher, and sit_shapes. Seated, sitting, or leg/knee notes map to sit_shapes with seated_leg_lift. Webcam hand input is hand-closure tracking, never grip-strength measurement.
Raw camera video is never uploaded or stored.`;

const functionTools: OpenAI.Responses.FunctionTool[] = [
  {
    type: "function",
    name: "extract_exercise_claims",
    description: "Return all exercise claims with source evidence and confidence. Null means not stated.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan"],
      properties: { plan: { type: "object", additionalProperties: true } }
    }
  },
  {
    type: "function",
    name: "find_conflicts",
    description: "Identify conflicting values and cite both source snippets.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan"],
      properties: { plan: { type: "object", additionalProperties: true } }
    }
  },
  {
    type: "function",
    name: "validate_plan",
    description: "Validate that required instructions are explicit and no instruction was invented.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan"],
      properties: { plan: { type: "object", additionalProperties: true } }
    }
  },
  {
    type: "function",
    name: "ask_clarification",
    description: "Ask exactly one plain-language question when required instructions conflict or are absent.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "question"],
      properties: {
        plan: { type: "object", additionalProperties: true },
        question: { type: "string" }
      }
    }
  },
  {
    type: "function",
    name: "generate_game_spec",
    description: "Create a constrained GameSpec only from a fully validated ExercisePlan.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan"],
      properties: { plan: { type: "object", additionalProperties: true } }
    }
  }
];

function stepsFromPlan(plan: ExercisePlan, gameSpec: GameSpec | null): AgentStep[] {
  const extracted = plan.bodyPart.value
    ? `Extracted ${plan.bodyPart.value}${plan.movement.value ? ` / ${plan.movement.value}` : ""}`
    : "No body part or movement was stated";
  const conflict = plan.conflicts[0];
  return [
    { tool: "extract_exercise_claims", status: "ok", detail: extracted },
    {
      tool: "find_conflicts",
      status: conflict ? "blocked" : "ok",
      detail: conflict ? `Conflicting ${conflict.field}: ${conflict.values.join(" vs ")}` : "No conflicting required instructions"
    },
    {
      tool: "validate_plan",
      status: plan.status === "ready" ? "ok" : "blocked",
      detail: plan.status === "ready" ? "Required fields are explicit and sourced" : plan.clarificationQuestion ?? "Needs clarification"
    },
    plan.status === "ready" && gameSpec
      ? { tool: "generate_game_spec", status: "ok", detail: `${gameSpec.title} · ${gameSpec.gameplay.targetCount} therapist-defined targets` }
      : { tool: "ask_clarification", status: "blocked", detail: plan.clarificationQuestion ?? "Ask one clarifying question" }
  ];
}

export function compileWithLocalTools(
  text: string,
  metadata: Record<string, unknown> = {},
  sessionId?: string,
  provider = "rox-tool-loop"
): CompileResult {
  const plan = extractExercisePlan(text, { sourceId: String(metadata.fileName ?? "patient-note") });
  const gameSpec = plan.status === "ready" ? generateGameSpec(plan, sessionId ?? plan.id) : null;
  return {
    sessionId: sessionId ?? plan.id,
    plan,
    gameSpec,
    provider,
    steps: stepsFromPlan(plan, gameSpec)
  };
}

export function attachAgentSteps(payload: {
  sessionId?: string;
  plan?: unknown;
  gameSpec?: unknown;
  provider?: string;
  steps?: AgentStep[];
}): CompileResult {
  const plan = ExercisePlanSchema.parse(payload.plan);
  const gameSpec = payload.gameSpec ? GameSpecSchema.parse(payload.gameSpec) : null;
  return {
    sessionId: String(payload.sessionId ?? plan.id),
    plan,
    gameSpec,
    provider: payload.provider ?? "therapy-game-agent",
    steps: payload.steps?.length ? payload.steps : stepsFromPlan(plan, gameSpec)
  };
}

export async function compileWithOpenAI(
  text: string,
  metadata: Record<string, unknown> = {},
  sessionId = crypto.randomUUID()
): Promise<CompileResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return compileWithLocalTools(text, metadata, sessionId);

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const steps: AgentStep[] = [];
  let plan: ExercisePlan | null = null;
  let gameSpec: GameSpec | null = null;

  let response = await client.responses.create({
    model,
    instructions: SYSTEM,
    input: JSON.stringify({ extractedText: text, metadata }),
    tools: functionTools,
    tool_choice: "required",
    parallel_tool_calls: false
  });

  for (let turn = 0; turn < 8; turn++) {
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );
    if (!calls.length) break;

    const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] = [];
    for (const call of calls) {
      const args = JSON.parse(call.arguments) as { plan?: unknown; question?: string };
      if (call.name === "generate_game_spec") {
        plan = ExercisePlanSchema.parse(args.plan);
        if (plan.status !== "ready" || plan.conflicts.length) {
          steps.push({ tool: "generate_game_spec", status: "blocked", detail: plan.clarificationQuestion ?? "Needs clarification" });
          throw new Error("Needs clarification before a game can be created");
        }
        gameSpec = generateGameSpec(plan, sessionId);
        steps.push({ tool: "generate_game_spec", status: "ok", detail: `${gameSpec.title} · ${gameSpec.gameplay.targetCount} therapist-defined targets` });
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, plan, gameSpec }) });
        continue;
      }

      plan = ExercisePlanSchema.parse(args.plan);
      if (call.name === "ask_clarification" && args.question) {
        plan = ExercisePlanSchema.parse({
          ...plan,
          status: "needs_clarification",
          clarificationQuestion: args.question
        });
      }
      const detail = call.name === "find_conflicts" && plan.conflicts[0]
        ? `Conflicting ${plan.conflicts[0].field}: ${plan.conflicts[0].values.join(" vs ")}`
        : call.name === "ask_clarification"
          ? plan.clarificationQuestion ?? "Clarification required"
          : call.name === "validate_plan"
            ? (plan.status === "ready" ? "Required fields are explicit and sourced" : plan.clarificationQuestion ?? "Needs clarification")
            : plan.bodyPart.value
              ? `Extracted ${plan.bodyPart.value}${plan.movement.value ? ` / ${plan.movement.value}` : ""}`
              : "No body part or movement was stated";
      steps.push({
        tool: call.name as AgentStep["tool"],
        status: call.name === "ask_clarification" || plan.status !== "ready" && call.name === "validate_plan" ? "blocked" : "ok",
        detail
      });
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, plan }) });
    }

    if (gameSpec || plan?.status === "needs_clarification") break;
    response = await client.responses.create({
      model,
      instructions: SYSTEM,
      previous_response_id: response.id,
      input: outputs,
      tools: functionTools,
      tool_choice: "required",
      parallel_tool_calls: false
    });
  }

  if (!plan) throw new Error("Agent did not return a valid ExercisePlan");
  if (plan.status === "ready" && !gameSpec) gameSpec = generateGameSpec(plan, sessionId);
  return {
    sessionId,
    plan,
    gameSpec: plan.status === "ready" ? gameSpec : null,
    provider: "rox-openai-tools",
    steps: steps.length ? steps : stepsFromPlan(plan, gameSpec)
  };
}
