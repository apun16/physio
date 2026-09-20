import { describe, expect, it, vi } from "vitest";
import { chunkNote, focusNote, RERANK_QUERY } from "./rerank";

const NOISE = [
  "PATIENT DEMOGRAPHICS\nName: [redacted]  DOB: 1961-04-02  MRN: 88213-04  Insurer: Provincial Plan B",
  "BILLING CODES\n97110 therapeutic exercise, 97530 therapeutic activity, 97112 neuromuscular re-education.",
  "PAST MEDICAL HISTORY\nHypertension managed with amlodipine. Cholecystectomy 2009. No known drug allergies.",
  "PRIOR EPISODE 2019\nPatient previously completed a lower limb program following a meniscal repair. Discharged at full function.",
  "ADMINISTRATIVE\nReferral received 2026-02-11. Intake call completed. Consent form on file. Interpreter not required.",
  "ATTENDANCE\nAttended 6 of 8 scheduled sessions. Two cancellations due to transport.",
  "EQUIPMENT ISSUED\nResistance band (green), 1 kg cuff weight, printed home program booklet.",
  "FOLLOW UP\nReview with physiatrist in 8 weeks. Contact clinic reception to rebook."
];

const SIGNAL = [
  "HOME EXERCISE PROGRAM\nShoulder flexion in supine, 3 sets of 10 repetitions, twice daily. Keep elbow extended.",
  "Scapular retraction seated, 3 sets of 12 repetitions, once daily, hold 5 seconds at end range.",
  "PRECAUTIONS\nDo not exceed 90 degrees of shoulder abduction for the next 4 weeks. Stop if pain exceeds 4/10.",
  "PROGRESSION\nAdvance to 15 repetitions once 10 are completed without compensation on two consecutive days."
];

/** Signal sections interleaved through the noise, as they would be in a real note. */
const NOTE = [NOISE[0], NOISE[1], NOISE[2], SIGNAL[0], SIGNAL[1], NOISE[3], NOISE[4], SIGNAL[2], NOISE[5], NOISE[6], SIGNAL[3], NOISE[7]].join("\n\n");

/** Stand-in for Cohere: scores by how much prescription vocabulary a chunk has. */
function fakeCohere(status = 200) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { documents: string[]; top_n: number; query: string };
    expect(body.query).toBe(RERANK_QUERY);
    const scored = body.documents
      .map((doc, index) => {
        const hits = (doc.match(/repetition|sets|daily|range|degrees|precaution|progress|hold/gi) ?? []).length;
        return { index, relevance_score: hits };
      })
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, body.top_n);
    return {
      ok: status === 200,
      status,
      json: async () => ({ results: scored })
    } as Response;
  });
}

describe("chunkNote", () => {
  it("glues a bare heading onto the section beneath it", () => {
    const chunks = chunkNote("PRECAUTIONS\n\nDo not exceed 90 degrees of abduction for four weeks.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("PRECAUTIONS");
    expect(chunks[0]).toContain("90 degrees");
  });

  it("keeps separate sections separate so noise can be dropped alone", () => {
    const chunks = chunkNote(NOTE);
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    const billing = chunks.filter((c) => c.includes("BILLING CODES"));
    expect(billing).toHaveLength(1);
    expect(billing[0]).not.toContain("Shoulder flexion");
  });

  it("splits a long unbroken block on sentence boundaries", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about the shoulder program.`).join(" ");
    const chunks = chunkNote(long, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 360)).toBe(true);
    expect(chunks.join(" ")).toContain("Sentence number 39");
  });

  it("keeps every section of the note", () => {
    const chunks = chunkNote(NOTE);
    expect(chunks.join("\n\n")).toContain("Shoulder flexion in supine");
    expect(chunks.join("\n\n")).toContain("Do not exceed 90 degrees");
  });
});

describe("focusNote", () => {
  it("keeps the prescription and drops the admin padding", async () => {
    const fetchImpl = fakeCohere();
    const result = await focusNote(NOTE, { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch, minChars: 100 });

    expect(result.applied).toBe(true);
    expect(result.kept).toBeLessThan(result.total);
    // Everything the compiler needs survives.
    expect(result.text).toContain("3 sets of 10 repetitions");
    expect(result.text).toContain("Do not exceed 90 degrees");
    expect(result.text).toContain("Advance to 15 repetitions");
    // The padding is gone.
    expect(result.text).not.toContain("BILLING CODES");
    expect(result.text).not.toContain("Interpreter not required");
    expect(result.text.length).toBeLessThan(NOTE.length);
  });

  it("returns the kept sections in document order, not ranking order", async () => {
    const fetchImpl = fakeCohere();
    const result = await focusNote(NOTE, { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch, minChars: 100 });
    const flexion = result.text.indexOf("Shoulder flexion");
    const precaution = result.text.indexOf("Do not exceed 90 degrees");
    const progression = result.text.indexOf("Advance to 15 repetitions");
    expect(flexion).toBeGreaterThanOrEqual(0);
    expect(precaution).toBeGreaterThan(flexion);
    expect(progression).toBeGreaterThan(precaution);
  });

  it("passes the note through untouched when there is no API key", async () => {
    const result = await focusNote(NOTE, { apiKey: undefined, minChars: 100 });
    expect(result.applied).toBe(false);
    expect(result.text).toBe(NOTE);
    expect(result.skipped).toMatch(/COHERE_API_KEY/);
  });

  it("passes short notes through without calling the API", async () => {
    const fetchImpl = fakeCohere();
    const short = "Shoulder flexion, 3 sets of 10, twice daily.";
    const result = await focusNote(short, { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.applied).toBe(false);
    expect(result.text).toBe(short);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the full note when Cohere errors", async () => {
    const fetchImpl = fakeCohere(500);
    const result = await focusNote(NOTE, { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch, minChars: 100 });
    expect(result.applied).toBe(false);
    expect(result.text).toBe(NOTE);
    expect(result.skipped).toMatch(/500/);
  });

  it("falls back to the full note when the request throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); });
    const result = await focusNote(NOTE, { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch, minChars: 100 });
    expect(result.applied).toBe(false);
    expect(result.text).toBe(NOTE);
    expect(result.skipped).toBe("network down");
  });
});
