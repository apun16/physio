import OpenAI from "openai";
import { Agent, type Connection, type WSMessage } from "agents";
import {
  ExercisePlanSchema,
  GameSpecSchema,
  SessionSummarySchema,
  type ExercisePlan,
  type GameSpec,
  type TherapyAgentState
} from "./therapy-schemas";

type TherapyEnv = Env & {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
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
    description:
      "Return all exercise claims with source evidence and confidence. Null means not stated.",
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
    description:
      "Validate that required instructions are explicit and no instruction was invented.",
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
    name: "ask_clarification",
    description:
      "Ask exactly one plain-language question when required instructions conflict or are absent.",
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
    description:
      "Create a constrained GameSpec only from a fully validated ExercisePlan.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["plan", "gameSpec"],
      properties: {
        plan: { type: "object", additionalProperties: true },
        gameSpec: { type: "object", additionalProperties: true }
      }
    }
  },
  {
    type: "function",
    name: "start_calibration",
    description: "Move a ready session into local camera calibration.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    type: "function",
    name: "pause_for_low_confidence",
    description:
      "Pause scoring when browser movement confidence falls below threshold.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["confidence"],
      properties: { confidence: { type: "number", minimum: 0, maximum: 1 } }
    }
  },
  {
    type: "function",
    name: "mark_attempt_unscorable",
    description:
      "Record an attempt that must not count because confidence was too low.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["confidence"],
      properties: { confidence: { type: "number", minimum: 0, maximum: 1 } }
    }
  },
  {
    type: "function",
    name: "save_session_summary",
    description: "Persist summarized metrics only after a completed session.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "object", additionalProperties: true } }
    }
  }
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type"
    }
  });

function ensureNoTreatmentChanges(plan: ExercisePlan, spec: GameSpec) {
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

export class TherapyGameAgent extends Agent<TherapyEnv, TherapyAgentState> {
  initialState: TherapyAgentState = {
    sessionId: "",
    phase: "intake",
    plan: null,
    gameSpec: null,
    confidenceEvents: [],
    summary: null
  };

  async onRequest(request: Request) {
    if (request.method === "OPTIONS") return json({});
    if (request.method === "GET") return json(this.state);
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    const body = await request.json<{
      type?: string;
      text?: string;
      metadata?: Record<string, unknown>;
      answer?: string;
      confidence?: number;
      summary?: unknown;
    }>();
    if (body.type === "compile" && body.text) {
      try {
        const result = await this.compile(
          body.text.slice(0, 30_000),
          body.metadata ?? {}
        );
        return json(result);
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : "Compilation failed"
          },
          422
        );
      }
    }
    if (body.type === "start_calibration") {
      this.setState({ ...this.state, phase: "calibration" });
      return json(this.state);
    }
    if (
      body.type === "pause_for_low_confidence" &&
      typeof body.confidence === "number"
    ) {
      this.recordConfidence(body.confidence, "pause");
      return json(this.state);
    }
    if (
      body.type === "mark_attempt_unscorable" &&
      typeof body.confidence === "number"
    ) {
      this.recordConfidence(body.confidence, "unscorable");
      return json(this.state);
    }
    if (body.type === "save_session_summary") {
      await this.persistSummary(body.summary);
      return json(this.state);
    }
    return json({ error: "Unsupported request" }, 400);
  }

  onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({ type: "therapy-state", state: this.state })
    );
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    const data = JSON.parse(message) as {
      type?: string;
      confidence?: number;
      summary?: unknown;
    };
    if (data.type === "start_calibration") {
      this.setState({ ...this.state, phase: "calibration" });
    } else if (
      data.type === "movement_confidence" &&
      typeof data.confidence === "number"
    ) {
      if (
        this.state.gameSpec &&
        data.confidence < this.state.gameSpec.tracking.confidenceThreshold
      ) {
        this.recordConfidence(data.confidence, "pause");
      }
    } else if (
      data.type === "attempt_unscorable" &&
      typeof data.confidence === "number"
    ) {
      this.recordConfidence(data.confidence, "unscorable");
    } else if (data.type === "session_complete") {
      await this.persistSummary(data.summary);
    }
    connection.send(
      JSON.stringify({ type: "therapy-state", state: this.state })
    );
  }

  private async persistSummary(raw: unknown) {
    const summary = SessionSummarySchema.parse(raw);
    this.setState({ ...this.state, phase: "complete", summary });
    await this.runWorkflow("THERAPY_SESSION_SUMMARY", summary, {
      id: `summary-${this.state.sessionId}`,
      agentBinding: "TherapyGameAgent"
    });
  }

  private recordConfidence(
    confidence: number,
    action: "pause" | "unscorable" | "resume"
  ) {
    this.setState({
      ...this.state,
      phase: action === "pause" ? "paused" : this.state.phase,
      confidenceEvents: [
        ...this.state.confidenceEvents.slice(-199),
        { at: new Date().toISOString(), confidence, action }
      ]
    });
  }

  private async compile(text: string, metadata: Record<string, unknown>) {
    if (!this.env.OPENAI_API_KEY)
      throw new Error("OPENAI_API_KEY is not configured on the Worker");
    const client = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });
    let response = await client.responses.create({
      model: this.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      instructions: SYSTEM,
      input: JSON.stringify({ extractedText: text, metadata }),
      tools: functionTools,
      tool_choice: "required",
      parallel_tool_calls: false
    });
    let plan: ExercisePlan | null = null;
    let gameSpec: GameSpec | null = null;
    const steps: { tool: string; status: "ok" | "blocked"; detail: string }[] = [];

    for (let step = 0; step < 8; step++) {
      const calls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === "function_call"
      );
      if (!calls.length) break;
      const outputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] =
        [];
      for (const call of calls) {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        let output: unknown = { ok: true };
        if (
          [
            "extract_exercise_claims",
            "validate_plan",
            "find_conflicts",
            "ask_clarification"
          ].includes(call.name)
        ) {
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
                ? plan.clarificationQuestion ?? "Clarification required"
                : plan.bodyPart.value ?? "Claims extracted"
          });
          output = { ok: true, plan };
        } else if (call.name === "generate_game_spec") {
          plan = ExercisePlanSchema.parse(args.plan);
          if (plan.status !== "ready" || plan.conflicts.length)
            throw new Error("Needs clarification");
          gameSpec = GameSpecSchema.parse(args.gameSpec);
          ensureNoTreatmentChanges(plan, gameSpec);
          steps.push({
            tool: call.name,
            status: "ok",
            detail: `${gameSpec.title} · ${gameSpec.gameplay.targetCount} therapist-defined targets`
          });
          output = { ok: true, plan, gameSpec };
        } else if (call.name === "start_calibration") {
          this.setState({ ...this.state, phase: "calibration" });
          output = { ok: true, phase: "calibration" };
        } else if (call.name === "pause_for_low_confidence") {
          this.recordConfidence(Number(args.confidence), "pause");
          output = { ok: true, phase: "paused" };
        } else if (call.name === "mark_attempt_unscorable") {
          this.recordConfidence(Number(args.confidence), "unscorable");
          output = { ok: true, action: "unscorable" };
        } else if (call.name === "save_session_summary") {
          await this.persistSummary(args.summary);
          output = { ok: true, summary: this.state.summary };
        }
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(output)
        });
      }
      if (gameSpec || plan?.status === "needs_clarification") break;
      response = await client.responses.create({
        model: this.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        instructions: SYSTEM,
        previous_response_id: response.id,
        input: outputs,
        tools: functionTools,
        tool_choice: "required",
        parallel_tool_calls: false
      });
    }
    if (!plan) throw new Error("Agent did not return a valid ExercisePlan");
    const sessionId = this.state.sessionId || crypto.randomUUID();
    this.setState({
      ...this.state,
      sessionId,
      phase: gameSpec ? "review" : "clarification",
      plan,
      gameSpec
    });
    return { sessionId, plan, gameSpec, provider: "therapy-game-agent", steps };
  }
}
