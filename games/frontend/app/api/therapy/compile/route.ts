import { attachAgentSteps, compileWithLocalTools } from "../../../../lib/therapy/agent-compile";

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

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (bodyText.length > 50_000) return Response.json({ error: "Note is too large" }, { status: 413 });
  let body: { text?: string; metadata?: Record<string, unknown>; sessionId?: string };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) return Response.json({ error: "No exercise note text was provided" }, { status: 400 });

  const sessionId = body.sessionId ?? crypto.randomUUID();
  const metadata = body.metadata ?? {};
  let lastError: unknown;

  for (const origin of agentOrigins()) {
    try {
      const response = await fetch(`${origin.replace(/\/$/, "")}/agents/therapy-game-agent/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "compile", text, metadata }),
        signal: AbortSignal.timeout(process.env.THERAPY_AGENT_URL ? 20_000 : 2500)
      });
      const payload = await response.json() as { error?: string; sessionId?: string; plan?: unknown; gameSpec?: unknown; steps?: never[] };
      if (!response.ok) throw new Error(payload.error ?? "Therapy agent compilation failed");
      return Response.json({ ...attachAgentSteps({ ...payload, provider: "therapy-game-agent" }), sessionId: payload.sessionId ?? sessionId });
    } catch (error) {
      lastError = error;
    }
  }

  const fallback = compileWithLocalTools(text, metadata, sessionId, "local-safe-demo");
  return Response.json({
    ...fallback,
    provider: lastError
      ? `${fallback.provider} · recovered after ${lastError instanceof Error ? lastError.message : "agent error"}`
      : fallback.provider
  });
}
