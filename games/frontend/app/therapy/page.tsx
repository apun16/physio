import TherapyCompiler from "./therapy-compiler";

export const metadata = {
  title: "Therapy Game Compiler · RePlay",
  description: "Turn a therapist-authored exercise note into a camera-controlled game."
};

export default function TherapyPage() {
  return <TherapyCompiler />;
}
