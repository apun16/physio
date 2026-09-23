/**
 * Cohere Rerank pass over an extracted therapy note.
 *
 * `extract.ts` concatenates every page of a PDF, so a long discharge summary
 * arrives mostly as history, billing codes and admin boilerplate with the
 * actual prescription buried inside it. Sending all of that to the compiler
 * wastes context and gives the model more chances to pick up a stale exercise
 * from the patient's history.
 *
 */

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";
const DEFAULT_MODEL = "rerank-v3.5";

export const RERANK_QUERY =
  "prescribed rehabilitation exercises, sets, repetitions, frequency, range of motion limits, " +
  "progression criteria, precautions and contraindications";

export type RerankOutcome = {
  text: string;
  applied: boolean;
  kept: number;
  total: number;
  model?: string;
  skipped?: string;
};

export type RerankOptions = {
  apiKey?: string;
  model?: string;
  minChars?: number;
  minChunks?: number;
  keepRatio?: number;
  minKeep?: number;
  fetchImpl?: typeof fetch;
};

const HEADING_CHARS = 80;

/**
 * Blank lines are the boundary because `extract.ts` joins pages with
 * "\n\n". One section per chunk is the point: merging neighbours together
 * would glue the billing codes to the prescription and make it impossible to
 * drop one without the other. The only merge is a bare heading onto the lines
 * beneath it, so "PRECAUTIONS" is ranked with the precautions.
 */
export function chunkNote(text: string, maxChars = 1200): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.length < HEADING_CHARS && !previous.includes("\n")) {
      merged[merged.length - 1] = `${previous}\n${block}`;
    } else {
      merged.push(block);
    }
  }

  const chunks: string[] = [];
  for (const block of merged) {
    if (block.length <= maxChars) {
      chunks.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?]+[.!?]*\s*/g) ?? [block];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > maxChars) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}

type CohereRerankResponse = { results?: { index: number; relevance_score: number }[] };

export async function focusNote(text: string, options: RerankOptions = {}): Promise<RerankOutcome> {
  const {
    apiKey = process.env.COHERE_API_KEY,
    model = process.env.COHERE_RERANK_MODEL ?? DEFAULT_MODEL,
    minChars = 2500,
    minChunks = 6,
    keepRatio = 0.4,
    minKeep = 3,
    fetchImpl = fetch
  } = options;

  const chunks = chunkNote(text);
  const base: RerankOutcome = { text, applied: false, kept: chunks.length, total: chunks.length };

  if (!apiKey) return { ...base, skipped: "COHERE_API_KEY not set" };
  if (text.length < minChars) return { ...base, skipped: `note under ${minChars} chars` };
  if (chunks.length < minChunks) return { ...base, skipped: `only ${chunks.length} sections` };

  const keep = Math.max(minKeep, Math.ceil(chunks.length * keepRatio));
  if (keep >= chunks.length) return { ...base, skipped: "nothing to trim" };

  try {
    const response = await fetchImpl(COHERE_RERANK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, query: RERANK_QUERY, documents: chunks, top_n: keep })
    });
    if (!response.ok) return { ...base, skipped: `rerank HTTP ${response.status}` };
    const payload = (await response.json()) as CohereRerankResponse;
    const results = payload.results ?? [];
    if (!results.length) return { ...base, skipped: "rerank returned no results" };

    // Back into document order: the compiler reads this as prose, and the
    // ranking order would scramble the note.
    const indexes = results
      .map((result) => result.index)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < chunks.length)
      .sort((a, b) => a - b);
    if (!indexes.length) return { ...base, skipped: "rerank returned no usable indexes" };

    return {
      text: indexes.map((index) => chunks[index]).join("\n\n"),
      applied: true,
      kept: indexes.length,
      total: chunks.length,
      model
    };
  } catch (reason) {
    return { ...base, skipped: reason instanceof Error ? reason.message : "rerank failed" };
  }
}
