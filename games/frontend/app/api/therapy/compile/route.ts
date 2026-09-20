import { attachAgentSteps, compileWithLocalTools, type CompileResult } from "../../../../lib/therapy/agent-compile";
import { focusNote, type RerankOutcome } from "../../../../lib/therapy/rerank";

function agentOrigins() {
  if (process.env.THERAPY_AGENT_URL) return [process.env.THERAPY_AGENT_URL];
  if (process.env.NODE_ENV === "production") return [];
  return [
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5173",
    "http://localhost:5174"
  ];
}

/** Record the retrieval pass on the response so the UI can show what was read. */
function withRetrieval(result: CompileResult, focus: RerankOutcome) {
  if (!focus.applied) return { ...result, retrieval: focus };
  return {
    ...result,
    provider: `${result.provider} · cohere ${focus.model} kept ${focus.kept}/${focus.total}`,
    retrieval: focus
  };
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (bodyText.length > 50_000) return Response.json({ error: "Note is too large" }, { status: 413 });
  let body: { text?: string; metadata?: Record<string, unknown>; sessionId?: string };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const rawText = body.text?.trim();
  if (!rawText) return Response.json({ error: "No exercise note text was provided" }, { status: 400 });

  const sessionId = body.sessionId ?? crypto.randomUUID();
  const metadata = body.metadata ?? {};
  let lastError: unknown;

  // Rank the note's sections and keep the ones that actually describe the
  // prescription. Runs server side so the Cohere key never reaches the browser,
  // and falls through to the full note whenever it cannot help.
  const focus = await focusNote(rawText);
  const text = focus.text;

  for (const origin of agentOrigins()) {
    try {
      const response = await fetch(`${origin.replace(/\/$/, "")}/agents/therapy-game-agent/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "compile", text, metadata })
      });
      const payload = await response.json() as { error?: string; sessionId?: string; plan?: unknown; gameSpec?: unknown; steps?: never[] };
      if (!response.ok) throw new Error(payload.error ?? "Therapy agent compilation failed");
      const compiled = attachAgentSteps({ ...payload, provider: "therapy-game-agent" });
      return Response.json({ ...withRetrieval(compiled, focus), sessionId: payload.sessionId ?? sessionId });
    } catch (error) {
      lastError = error;
    }
  }

  const fallback = withRetrieval(compileWithLocalTools(text, metadata, sessionId, "local-safe-demo"), focus);
  return Response.json({
    ...fallback,
    provider: lastError
      ? `${fallback.provider} · recovered after ${lastError instanceof Error ? lastError.message : "agent error"}`
      : fallback.provider
  });
}
