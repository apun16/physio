import type { AnalysisRequest } from "../../../lib/rehab/analysis";

// Works with OpenAI or any OpenAI-compatible endpoint (e.g. a Baseten-hosted model):
// set OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL.
const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const TIMEOUT_MS = 8000;

const SYSTEM = `You are a supportive rehab-exercise coach reading results from a video-game physiotherapy session.
Use ONLY the numbers given. Never invent measurements, diagnose, or give medical advice; for pain or worrying trends, suggest checking with their therapist.
Compare against history when present (say what improved or slipped, with the actual numbers); otherwise say it is the first session.
Metric key hints: *Pct = percent, *Deg = degrees, "bias" > 0 means drifting right of the ideal line, < 0 left. errorStart vs errorEnd shows fatigue if the end is worse.
Keep it short, warm and concrete: plain language, no jargon, second person.`;

const SCHEMA = {
  name: "rehab_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "observations", "progress", "nextStep", "focus"],
    properties: {
      headline: { type: "string", description: "One encouraging sentence, max 12 words" },
      observations: { type: "array", minItems: 2, maxItems: 3, items: { type: "string", description: "One specific finding citing a number, max 20 words" } },
      progress: { type: "string", description: "Change vs previous sessions, max 25 words" },
      nextStep: { type: "string", description: "One concrete thing to try next session, max 25 words" },
      focus: { type: "string", enum: ["range", "precision", "smoothness", "consistency", "endurance"] }
    }
  }
} as const;

function isPlainRecord(value: unknown): value is Record<string, number | string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((v) => typeof v === "number" || typeof v === "string");
}

function parse(input: unknown): AnalysisRequest | null {
  const body = input as Partial<AnalysisRequest> | null;
  if (!body || typeof body.game !== "string" || typeof body.input !== "string") return null;
  if (!isPlainRecord(body.metrics) || Object.keys(body.metrics).length > 40) return null;
  if (!Array.isArray(body.history) || body.history.length > 10 || !body.history.every(isPlainRecord)) return null;
  return {
    game: body.game.slice(0, 40),
    input: body.input.slice(0, 40),
    level: Number(body.level) || 1,
    levelLabel: String(body.levelLabel ?? "").slice(0, 40),
    metrics: body.metrics,
    history: body.history.slice(-5)
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not set" }, { status: 503 });

  const text = await request.text();
  if (text.length > 20_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const req = parse((() => { try { return JSON.parse(text); } catch { return null; } })());
  if (!req) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const started = performance.now();
  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 350,
        response_format: { type: "json_schema", json_schema: SCHEMA },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify({ game: req.game, input: req.input, level: `${req.level} (${req.levelLabel})`, thisSession: req.metrics, previousSessions: req.history }) }
        ]
      })
    });
    if (!upstream.ok) {
      console.error(`[analyze] upstream ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`);
      return Response.json({ error: "Analysis unavailable" }, { status: 502 });
    }
    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const result = JSON.parse(data.choices?.[0]?.message?.content ?? "");
    const ms = Math.round(performance.now() - started);
    console.log(`[analyze] ${req.game} ${MODEL} ${ms}ms`);
    return Response.json({ ...result, ms });
  } catch (reason) {
    console.error("[analyze] failed:", reason instanceof Error ? reason.message : reason);
    return Response.json({ error: "Analysis unavailable" }, { status: 502 });
  }
}
