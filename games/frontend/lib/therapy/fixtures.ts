export interface TherapyNoteFixture {
  id: string;
  label: string;
  kind: "clear" | "conflicting" | "incomplete" | "hand" | "seated-legs";
  text: string;
  metadata: { fileName: string; mimeType: string; note: string };
}

export const therapyNoteFixtures: TherapyNoteFixture[] = [
  {
    id: "clear-shoulder",
    label: "Clear shoulder note",
    kind: "clear",
    text: "Right shoulder flexion, 2 sets of 8. Avoid trunk lean. No overhead reaching.",
    metadata: { fileName: "demo-shoulder-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
  },
  {
    id: "conflicting-repetitions",
    label: "Conflicting repetitions",
    kind: "conflicting",
    text: "PDF typed instruction: Right shoulder flexion, 2 sets of 10. Avoid trunk lean.\nHandwritten addition: 8 reps.",
    metadata: { fileName: "demo-conflict-note.txt", mimeType: "text/plain", note: "Synthetic typed and handwritten sources" }
  },
  {
    id: "incomplete-shoulder",
    label: "Incomplete shoulder note",
    kind: "incomplete",
    text: "Shoulder reaches daily.",
    metadata: { fileName: "demo-incomplete-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
  },
  {
    id: "hand-strength",
    label: "Hand closure note",
    kind: "hand",
    text: "Ten controlled squeezes. Hold three seconds.",
    metadata: { fileName: "demo-hand-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
  },
  {
    id: "seated-leg-shapes",
    label: "Seated leg-shape note",
    kind: "seated-legs",
    text: "Seated leg lifts from a chair, 2 sets of 6. Hold two seconds. Match both legs together, one high and one low, then both high. Avoid leaning back.",
    metadata: { fileName: "demo-leg-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
  }
];
