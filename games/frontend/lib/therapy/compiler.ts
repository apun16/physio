import { ExercisePlanSchema, GameSpecSchema, type ExercisePlan, type GameSpec } from "./schemas";

type Source = { id: string; text: string; page?: number };

const evidence = (source: Source, snippet: string) => [{
  sourceId: source.id,
  snippet: snippet.trim().slice(0, 500),
  ...(source.page ? { page: source.page } : {})
}];

const claim = <T>(value: T | null, source: Source, snippet = "", confidence = value === null ? 0 : 0.9) => ({
  value,
  confidence,
  evidence: value === null || !snippet ? [] : evidence(source, snippet)
});

const wordNumber = (value: string) => {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return /^\d+$/.test(value) ? Number(value) : words[value.toLowerCase()];
};

export function findExerciseConflicts(sources: Source[]) {
  const candidates: { value: number; source: Source; snippet: string }[] = [];
  for (const source of sources) {
    for (const match of source.text.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:reps?|repetitions?)\b/gi)) {
      const value = wordNumber(match[1]);
      if (value) candidates.push({ value, source, snippet: match[0] });
    }
    const sets = source.text.match(/\b\d+\s*sets?\s+of\s+(\d+)\b/i);
    if (sets) candidates.push({ value: Number(sets[1]), source, snippet: sets[0] });
  }
  const values = [...new Set(candidates.map((candidate) => candidate.value))];
  return values.length > 1 ? [{
    field: "repetitions",
    values: values.map(String),
    evidence: candidates.map((candidate) => evidence(candidate.source, candidate.snippet)[0])
  }] : [];
}

function firstQuestion(plan: Omit<ExercisePlan, "status" | "clarificationQuestion">) {
  if (plan.conflicts.length) {
    const conflict = plan.conflicts[0];
    return `Your note lists ${conflict.values.join(" and ")} repetitions. Which number did your therapist intend?`;
  }
  if (!plan.bodyPart.value || !plan.movement.value) return "What body part and movement did your therapist ask you to practice?";
  if (!plan.side.value && plan.bodyPart.value !== "hand" && plan.bodyPart.value !== "legs") {
    return `Which side did your therapist specify for the ${plan.bodyPart.value} exercise?`;
  }
  if (!plan.repetitions.value) return "How many repetitions did your therapist prescribe?";
  if (!plan.sets.value) return "How many sets did your therapist prescribe?";
  if (plan.bodyPart.value === "hand" && !plan.side.value) return "Which hand did your therapist ask you to use?";
  return null;
}

export function extractExercisePlan(text: string, metadata: { sourceId?: string } = {}): ExercisePlan {
  const source = { id: metadata.sourceId ?? "patient-note", text };
  const lower = text.toLowerCase();
  const answers = [...text.matchAll(/clarification question:\s*([^\n]+)\npatient answer:\s*([^\n]+)/gi)]
    .map((match) => ({ question: match[1].toLowerCase(), answer: match[2].trim().toLowerCase(), snippet: match[0] }));
  const answerFor = (field: string) => [...answers].reverse().find((answer) => answer.question.includes(field));
  const shoulder = /\bshoulder\b/.test(lower);
  const hand = /\b(hand|squeeze|pinch|grip)\b/.test(lower);
  const legs = /\b(leg|legs|knee|knees|seated|sitting|sit|shin|thigh|ankle)\b/.test(lower);
  const bodyPart = hand && !legs ? "hand" : legs && !shoulder ? "legs" : shoulder ? "shoulder" : hand ? "hand" : null;
  const sideAnswer = answerFor("side") ?? answerFor("hand");
  const sideMatch = (sideAnswer?.answer ?? lower).match(/\b(left|right|bilateral|both)\b/);
  const side = bodyPart === "legs"
    ? "bilateral"
    : sideMatch?.[1] === "both" ? "bilateral" : (sideMatch?.[1] as "left" | "right" | "bilateral" | undefined) ?? null;
  const movement = bodyPart === "legs"
    ? "seated leg shapes"
    : shoulder
      ? (lower.includes("flexion") ? "shoulder flexion" : "shoulder reach")
      : hand ? (lower.includes("pinch") ? "pinch" : "controlled hand closure")
        : null;
  const setsOf = lower.match(/\b(\d+)\s*sets?\s+of\s+(\d+)\b/);
  const explicitReps = [...lower.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:controlled\s+)?(?:reps?|repetitions?|squeezes?|reaches?)\b/g)];
  const repetitionsAnswer = answerFor("repetition");
  const repetitionsAnswerNumber = repetitionsAnswer?.answer.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  const setsAnswer = answerFor("sets");
  const setsAnswerNumber = setsAnswer?.answer.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  const repetitionValue = repetitionsAnswerNumber ? wordNumber(repetitionsAnswerNumber[1]) : setsOf ? Number(setsOf[2]) : explicitReps[0] ? wordNumber(explicitReps[0][1]) : null;
  const setsValue = setsAnswerNumber ? wordNumber(setsAnswerNumber[1]) : setsOf ? Number(setsOf[1]) : /\bone set\b/.test(lower) ? 1 : null;
  const holdMatch = lower.match(/\b(?:hold\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*seconds?\b/);
  const restrictions = [...text.matchAll(/\b(?:avoid|no|do not|don't)\s+[^.!;\n]+/gi)].map((match) => match[0].trim());
  const compensation = restrictions.filter((item) => /lean|twist|shrug|compens/i.test(item));
  const equipment = [...text.matchAll(/\b(band|dumbbell|ball|putty|grip sensor|chair)\b/gi)].map((match) => match[0].toLowerCase());
  const conflicts = repetitionsAnswerNumber ? [] : findExerciseConflicts([source]);

  const partial = {
    id: crypto.randomUUID(),
    bodyPart: claim(bodyPart, source, bodyPart ? bodyPart : ""),
    side: claim(side, source, sideAnswer?.snippet ?? sideMatch?.[0] ?? ""),
    movement: claim(movement, source, movement ? text.match(/[^.!;\n]*(?:flexion|reach|squeeze|pinch|seated|sitting|leg|knee)[^.!;\n]*/i)?.[0] ?? movement : ""),
    startingPosition: claim<string>(null, source),
    repetitions: claim(repetitionValue, source, repetitionsAnswer?.snippet ?? setsOf?.[0] ?? explicitReps[0]?.[0] ?? ""),
    sets: claim(setsValue, source, setsAnswer?.snippet ?? setsOf?.[0] ?? ""),
    holdDurationSeconds: claim(holdMatch ? wordNumber(holdMatch[1]) : null, source, holdMatch?.[0] ?? "", holdMatch ? 0.94 : 0),
    equipment: claim(equipment, source, equipment.join(", "), equipment.length ? 0.9 : 0.65),
    restrictions: claim(restrictions, source, restrictions.join("; "), restrictions.length ? 0.95 : 0.65),
    compensationWarnings: claim(compensation, source, compensation.join("; "), compensation.length ? 0.95 : 0.65),
    frequency: claim(lower.includes("daily") ? "daily" : null, source, lower.includes("daily") ? "daily" : ""),
    conflicts
  };
  const clarificationQuestion = firstQuestion(partial);
  return ExercisePlanSchema.parse({
    ...partial,
    status: clarificationQuestion ? "needs_clarification" : "ready",
    clarificationQuestion
  });
}

export function generateGameSpec(plan: ExercisePlan, sessionId = plan.id): GameSpec {
  if (plan.status !== "ready" || plan.conflicts.length || !plan.bodyPart.value || !plan.movement.value || !plan.repetitions.value || !plan.sets.value) {
    throw new Error("Needs clarification before a game can be created");
  }
  const template = plan.bodyPart.value === "hand"
    ? "fruit_catcher"
    : plan.bodyPart.value === "legs" || plan.bodyPart.value === "ankle" || plan.bodyPart.value === "full body"
      ? "sit_shapes"
      : "arc_runner";
  const metric = template === "fruit_catcher"
    ? "hand_closure"
    : template === "sit_shapes"
      ? "seated_leg_lift"
      : plan.movement.value.includes("flexion") ? "shoulder_flexion" : "shoulder_reach";
  const mode = template === "fruit_catcher" ? "hand" : "pose";
  const title = template === "arc_runner" ? "Arc Runner" : template === "fruit_catcher" ? "Fruit Catcher" : "Sit Shapes";
  return GameSpecSchema.parse({
    version: 1,
    sessionId,
    title,
    template,
    exercise: {
      bodyPart: plan.bodyPart.value,
      side: plan.side.value ?? "not_applicable",
      movement: plan.movement.value,
      startingPosition: plan.startingPosition.value ?? "Camera-calibrated neutral starting position",
      repetitions: plan.repetitions.value,
      sets: plan.sets.value,
      holdDurationSeconds: plan.holdDurationSeconds.value ?? 0,
      restrictions: plan.restrictions.value ?? [],
      compensationWarnings: plan.compensationWarnings.value ?? []
    },
    tracking: {
      mode,
      metric,
      confidenceThreshold: template === "fruit_catcher" ? 0.62 : 0.55,
      hardwareGripPreferred: template === "fruit_catcher",
      webcamMeasurementLabel: template === "fruit_catcher"
        ? "Hand-closure tracking (not grip-strength measurement)"
        : template === "sit_shapes"
          ? "Side-view seated leg tracking"
          : "Camera movement tracking"
    },
    gameplay: {
      targetCount: plan.repetitions.value * plan.sets.value,
      targetHoldMs: (plan.holdDurationSeconds.value ?? 0) * 1000,
      pace: "therapist_defined",
      range: { minimum: null, maximum: null, unit: template === "fruit_catcher" ? "closure_ratio" : "normalized" }
    },
    safety: {
      launchAllowed: true,
      neverScoreBelowConfidence: true,
      doNotStoreRawVideo: true,
      instructionsSource: "therapist_note",
      warnings: [...new Set([...(plan.restrictions.value ?? []), ...(plan.compensationWarnings.value ?? [])])]
    }
  });
}

export function validateGameSpecAgainstPlan(plan: ExercisePlan, spec: GameSpec) {
  const parsed = GameSpecSchema.parse(spec);
  if (parsed.exercise.repetitions !== plan.repetitions.value || parsed.exercise.sets !== plan.sets.value) {
    throw new Error("GameSpec cannot change therapist-provided repetitions or sets");
  }
  return parsed;
}
