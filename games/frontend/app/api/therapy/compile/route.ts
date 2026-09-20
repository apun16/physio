import { attachAgentSteps, compileWithLocalTools, compileWithOpenAI } from "../../../../lib/therapy/agent-compile";

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
  const agentUrl = process.env.THERAPY_AGENT_URL;

  try {
    if (agentUrl) {
      const response = await fetch(`${agentUrl.replace(/\/$/, "")}/agents/therapy-game-agent/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "compile", text, metadata })
      });
      const payload = await response.json() as { error?: string; sessionId?: string; plan?: unknown; gameSpec?: unknown; steps?: never[] };
      if (!response.ok) throw new Error(payload.error ?? "Therapy agent compilation failed");
      return Response.json({ ...attachAgentSteps({ ...payload, provider: "therapy-game-agent" }), sessionId: payload.sessionId ?? sessionId });
    }

    if (process.env.OPENAI_API_KEY) {
      return Response.json(await compileWithOpenAI(text, metadata, sessionId));
    }

    return Response.json(compileWithLocalTools(text, metadata, sessionId));
  } catch (error) {
    const fallback = compileWithLocalTools(text, metadata, sessionId);
    if (fallback.plan) {
      return Response.json({
        ...fallback,
        provider: `${fallback.provider} · recovered after ${error instanceof Error ? error.message : "agent error"}`
      });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Compilation failed" }, { status: 422 });
  }
}
