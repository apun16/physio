import { ArrowRight } from "lucide-react";
import Link from "next/link";
import BootIntro from "./boot-intro";

function PixelMark() {
  return <span className="pixel-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>;
}

export default function HomePage() {
  return (
    <main className="world-home">
      <BootIntro />
      <div className="crt-layer" />
      <header className="world-header">
        <Link className="home-brand" href="/"><PixelMark /><span>PULSE<b>//VERSE</b></span></Link>
        <nav><Link href="/">HOME</Link><Link href="/dashboard">WORLDS</Link><Link href="/games/steer">PLAY</Link></nav>
      </header>

      <section className="world-hero">
        <div className="world-shade" />
        <div className="world-copy">
          <span>WELCOME TO THE</span>
          <h1><span>PULSE</span><b>//VERSE</b></h1>
          <p>YOUR MOVEMENT OPENS WORLDS</p>
          <Link href="/dashboard">ENTER THE PORTAL <ArrowRight size={17} /></Link>
        </div>

        <div className="world-scroll" aria-hidden="true"><i>↑</i><span>EXPLORE</span><i>↓</i></div>
        <nav className="world-links" aria-label="Game worlds">
          <Link href="/games/move"><span>01</span><div><b>SKYWARD</b><small>MOVE THROUGH TARGETS</small></div></Link>
          <Link href="/games/steer"><span>02</span><div><b>PULSE CIRCUIT</b><small>MASTER THE ROAD</small></div></Link>
          <Link href="/games/paintball"><span>03</span><div><b>INKBURST</b><small>SQUEEZE, AIM, SPLAT</small></div></Link>
        </nav>
        <div className="world-status">
          <b>PLAYER 01 // READY</b>
        </div>
      </section>
    </main>
  );
}
