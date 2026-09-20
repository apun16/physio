import TherapyCompiler from "./therapy-compiler";

export const metadata = {
  title: "Therapy Game Compiler · Pulse Verse",
  description: "Turn a therapist-authored exercise note into a camera-controlled game."
};

export default function TherapyPage() {
  return <TherapyCompiler />;
}
