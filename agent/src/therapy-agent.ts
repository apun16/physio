import OpenAI from "openai";
import { Agent, type Connection, type WSMessage } from "agents";
import { compileTherapyNote } from "./therapy-compile";
import {
  SessionSummarySchema,
  type TherapyAgentState
} from "./therapy-schemas";

type TherapyEnv = Env & {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type"
    }
  });

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
    const { plan, gameSpec, steps } = await compileTherapyNote(
      client,
      this.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      text,
      metadata
    );
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
