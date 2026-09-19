import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import RacingGame from "./racing-game";

const titles: Record<string, string> = {
  move: "Move",
  steer: "Steer",
  control: "Control"
};

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = titles[slug] ?? slug;

  if (slug === "steer") return <RacingGame />;

  return (
    <main className="game-stage">
      <header className="dash-top">
        <Link className="dash-back" href="/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
        <span className="logo-mark small" aria-hidden="true" />
      </header>
      <section className="game-stage-body">
        <span className="intro-kicker">Loading level</span>
        <h1>{title}</h1>
        <p>The live session view for this level connects here once the sensor stream is wired in.</p>
      </section>
    </main>
  );
}
