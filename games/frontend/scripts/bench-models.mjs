// Compare Baseten models on the same session payload, through the real /api/analyze route (dev server must be running).
//   node --env-file=.env.local scripts/bench-models.mjs [model-slug ...]
// With no slugs it lists the live catalog and benchmarks the first few chat models.
const key = process.env.BASETEN_API_KEY;
if (!key) { console.error("Set BASETEN_API_KEY in .env.local"); process.exit(1); }
const host = process.env.HOST ?? "http://localhost:3001";

const catalog = await fetch("https://inference.baseten.co/v1/models", { headers: { Authorization: `Bearer ${key}` } }).then((r) => r.json());
const all = (catalog.data ?? []).map((m) => m.id);
console.log(`catalog (${all.length}): ${all.join(", ")}\n`);
const models = process.argv.slice(2).length ? process.argv.slice(2) : all.slice(0, 5);

const payload = {
  game: "pulse-circuit", input: "hand-camera", level: 2, levelLabel: "Steady",
  metrics: { coinsHit: 19, coinsOffered: 28, accuracyPct: 68, onRoadPct: 91, smoothness0to100: 58, sweeps: 12, durationSec: 62, signalDrops: 0, laneSpread: 0.55, pickupWindow: 0.3, pathMatch0to100: 71, meanErrorFromOptimalPct: 17, worstErrorFromOptimalPct: 52, bias: 0.09, errorStartPct: 12, errorEndPct: 23, pathLengthVsOptimal: 1.4, verticalWobblePct: 4, handVisiblePct: 97 },
  history: [{ level: 2, accuracyPct: 61, onRoadPct: 88, smoothness0to100: 52, pathMatch0to100: 64 }],
  adjustable: { laneSpread: { current: 0.55, min: 0.3, max: 0.9, maxStep: 0.1 }, pickupWindow: { current: 0.3, min: 0.2, max: 0.36, maxStep: 0.04 } }
};

for (const model of models) {
  const times = [];
  let last;
  for (let run = 0; run < 2; run += 1) {
    const t = performance.now();
    const res = await fetch(`${host}/api/analyze?model=${encodeURIComponent(model)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    times.push(Math.round(performance.now() - t));
    last = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
  }
  console.log(`${model}\n  ${times.join("ms, ")}ms  tokens=${last.completionTokens ?? "?"}  ${last.error ?? `"${last.headline}"  adjust=${JSON.stringify(last.adjustments)}`}\n`);
}
