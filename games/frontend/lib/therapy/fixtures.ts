export interface TherapyNoteFixture {
  id: string;
  label: string;
  kind: "clear" | "conflicting" | "incomplete" | "hand";
  text: string;
  metadata: { fileName: string; mimeType: string; note: string };
}

export const clearShoulderNote: TherapyNoteFixture = {
  id: "clear-shoulder",
  label: "Clear shoulder note",
  kind: "clear",
  text: "Right shoulder flexion. 2 sets of 8. Avoid trunk lean. No overhead reaching.",
  metadata: { fileName: "demo-shoulder-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
};

export const conflictingRepetitionsNote: TherapyNoteFixture = {
  id: "conflicting-repetitions",
  label: "Conflicting repetitions",
  kind: "conflicting",
  text: "Right shoulder flexion. The typed plan says 2 sets of 10. Avoid trunk lean. Handwritten in the margin: 8 reps.",
  metadata: { fileName: "demo-conflict-note.txt", mimeType: "text/plain", note: "Synthetic typed and handwritten sources" }
};

export const incompleteShoulderNote: TherapyNoteFixture = {
  id: "incomplete-shoulder",
  label: "Incomplete shoulder note",
  kind: "incomplete",
  text: "Shoulder reaches daily.",
  metadata: { fileName: "demo-incomplete-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
};

export const handClosureNote: TherapyNoteFixture = {
  id: "hand-strength",
  label: "Hand closure note",
  kind: "hand",
  text: "Ten controlled squeezes. Hold three seconds.",
  metadata: { fileName: "demo-hand-note.txt", mimeType: "text/plain", note: "Synthetic demo only" }
};

export const therapyNoteFixtures: TherapyNoteFixture[] = [
  clearShoulderNote,
  conflictingRepetitionsNote,
  handClosureNote
];
