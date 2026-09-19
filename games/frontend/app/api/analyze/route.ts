import { clampAdjustments, type Adjustable, type AnalysisRequest, type AnalysisResult } from "../../../lib/rehab/analysis";

/**
 * Shared rehab analysis endpoint. Baseten Model APIs first (OpenAI-compatible),
 * OpenAI as a fallback. Set BASETEN_API_KEY (+ optional BASETEN_MODEL) and/or OPENAI_API_KEY.
 * ANALYSIS_PROVIDER=openai|baseten forces one provider.
 */

interface Provider { name: string; url: string; key: string; model: string }

function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.BASETEN_API_KEY) list.push({ name: "baseten", url: "https://inference.baseten.co/v1", key: process.env.BASETEN_API_KEY, model: process.env.BASETEN_MODEL ?? "zai-org/GLM-5.3" });
  if (process.env.OPENAI_API_KEY) list.push({ name: "openai", url: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" });
  const only = process.env.ANALYSIS_PROVIDER;
  return only ? list.filter((p) => p.name === only) : list;
}

const TIMEOUT_MS = 12000;
const FOCUS = ["range", "precision", "smoothness", "consistency", "endurance"] as const;

const SYSTEM = `You are a supportive rehab-exercise coach reading results from a video-game physiotherapy session.
Use ONLY the numbers given. Never invent measurements, diagnose, or give medical advice; for pain or worrying trends, suggest checking with their therapist.
Compare against history when present (say what improved or slipped, with the actual numbers); otherwise say it is the first session.
Metric key hints: *Pct = percent, *Deg = degrees, "bias" > 0 means drifting right of the ideal line, < 0 left. errorStartPct vs errorEndPct shows fatigue if the end is worse.
Keep it short, warm and concrete: plain language, no jargon, second person.
If "adjustable" settings are given, propose next-session values: make it slightly harder when the player was accurate, smooth and steady; easier or unchanged when they struggled, tired, or lost signal. Small steps only; stay within min/max and maxStep. Explain the choice in one short sentence.
Reply with ONLY a JSON object, no prose, no code fences.`;

function schemaFor(adjustable?: Record<string, Adjustable>) {
  const properties: Record<string, unknown> = {
    headline: { type: "string", description: "One encouraging sentence, max 12 words" },
    observations: { type: "array", minItems: 2, maxItems: 3, items: { type: "string", description: "One specific finding citing a number, max 20 words" } },
    progress: { type: "string", description: "Change vs previous sessions, max 25 words" },
    nextStep: { type: "string", description: "One concrete thing to try next session, max 25 words" },
    focus: { type: "string", enum: FOCUS }
  };
  if (adjustable) {
    properties.adjustments = { type: "object", additionalProperties: false, required: Object.keys(adjustable), properties: Object.fromEntries(Object.keys(adjustable).map((key) => [key, { type: "number" }])) };
    properties.adjustmentReason = { type: "string", description: "Why these settings, max 20 words" };
  }
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

function isPlainRecord(value: unknown): value is Record<string, number | string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((v) => typeof v === "number" || typeof v === "string");
}

function parseAdjustable(value: unknown): Record<string, Adjustable> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: Record<string, Adjustable> = {};
  for (const [key, a] of Object.entries(value).slice(0, 8)) {
    const { current, min, max, maxStep } = a as Adjustable;
    if ([current, min, max, maxStep].every((n) => Number.isFinite(n)) && min <= max) out[key.slice(0, 40)] = { current, min, max, maxStep };
  }
  return Object.keys(out).length ? out : undefined;
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
    history: body.history.slice(-5),
    adjustable: parseAdjustable(body.adjustable)
  };
}

/** Models sometimes wrap JSON in fences or a <think> block; take the outermost object. */
function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value.slice(0, 300) : fallback);

function shape(raw: Record<string, unknown>, req: AnalysisRequest) {
  const observations = Array.isArray(raw.observations) ? raw.observations.filter((o): o is string => typeof o === "string").slice(0, 3).map((o) => o.slice(0, 300)) : [];
  if (!text(raw.headline) || observations.length === 0) throw new Error("model output missing required fields");
  const focus = FOCUS.find((f) => f === raw.focus) ?? "consistency";
  const proposed = typeof raw.adjustments === "object" && raw.adjustments !== null ? (raw.adjustments as Record<string, unknown>) : null;
  return {
    headline: text(raw.headline),
    observations,
    progress: text(raw.progress),
    nextStep: text(raw.nextStep),
    focus,
    ...(req.adjustable && proposed ? { adjustments: clampAdjustments(req.adjustable, proposed), adjustmentReason: text(raw.adjustmentReason) } : {})
  };
}

async function call(provider: Provider, req: AnalysisRequest) {
  const user = JSON.stringify({ game: req.game, input: req.input, level: `${req.level} (${req.levelLabel})`, thisSession: req.metrics, previousSessions: req.history, adjustable: req.adjustable });
  const send = async (responseFormat: unknown, attempt = 0): Promise<Response> => {
    const response = await fetch(`${provider.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.3,
        max_tokens: 1200, // headroom for reasoning models
        response_format: responseFormat,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }]
      })
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      return send(responseFormat, attempt + 1);
    }
    return response;
  };

  let response = await send({ type: "json_schema", json_schema: { name: "rehab_analysis", strict: true, schema: schemaFor(req.adjustable) } });
  // Not every hosted model supports strict schemas: fall back to plain JSON mode (the prompt already spells out the shape).
  if (response.status === 400) response = await send({ type: "json_object" });
  if (!response.ok) throw new Error(`${provider.name} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { completion_tokens?: number } };
  return { raw: extractJson(data.choices?.[0]?.message?.content ?? ""), tokens: data.usage?.completion_tokens };
}

export async function POST(request: Request) {
  const available = providers();
  if (available.length === 0) return Response.json({ error: "Set BASETEN_API_KEY or OPENAI_API_KEY" }, { status: 503 });

  const body = await request.text();
  if (body.length > 20_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const req = parse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!req) return Response.json({ error: "Invalid payload" }, { status: 400 });

  // Dev only: ?model=<slug> tries another model on the first provider (used by scripts/bench-models.mjs).
  const override = process.env.NODE_ENV !== "production" ? new URL(request.url).searchParams.get("model") : null;
  const order = override ? [{ ...available[0], model: override }] : available;

  for (const provider of order) {
    const started = performance.now();
    try {
      const { raw, tokens } = await call(provider, req);
      const ms = Math.round(performance.now() - started);
      console.log(`[analyze] ${req.game} ${provider.name}/${provider.model} ${ms}ms tokens=${tokens ?? "?"}`);
      const result: AnalysisResult = { ...shape(raw, req), provider: provider.name, model: provider.model, ms, completionTokens: tokens };
      return Response.json(result);
    } catch (reason) {
      console.error(`[analyze] ${provider.name}/${provider.model} failed:`, reason instanceof Error ? reason.message : reason);
    }
  }
  return Response.json({ error: "Analysis unavailable" }, { status: 502 });
}
