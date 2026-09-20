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
  provider = "local-safe-demo"
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
