import { notFound } from "next/navigation";
import RacingGame from "./racing-game";
import SkywardGame from "./skyward-game";
import PaintballGameView from "./paintball-game";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (slug === "steer") return <RacingGame />;
  if (slug === "move") return <SkywardGame />;
  if (slug === "paintball") return <PaintballGameView />;

  notFound();
}
