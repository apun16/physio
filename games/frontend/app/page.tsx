import { ArrowRight, CirclePlay, Crosshair, Wifi } from "lucide-react";
import Link from "next/link";

function PixelMark() {
  return <span className="pixel-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>;
}

function PortalScene() {
  return (
    <div className="portal-scene" aria-hidden="true">
      <div className="portal-sky"><i /><i /><i /></div>
      <div className="pixel-sun" />
      <div className="world-mountains"><i /><i /><i /></div>
      <div className="pixel-city">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>
      <div className="game-road"><i /><i /><i /></div>
      <div className="runner"><i className="runner-head" /><i className="runner-body" /><i className="runner-arm" /><i className="runner-leg one" /><i className="runner-leg two" /></div>
      <div className="target-ring"><i /><i /><b /></div>
      <div className="floating-blocks"><i /><i /><i /><i /><i /><i /></div>
      <div className="portal-hud"><span>ROM LINKED</span><b>98%</b></div>
      <div className="combo-pop">SMOOTH!<span>+250 XP</span></div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="pixel-home">
      <div className="crt-layer" />
      <header className="home-header">
        <Link className="home-brand" href="/"><PixelMark /><span>PULSE<b>//VERSE</b></span></Link>
        <nav aria-label="Main navigation"><a className="active" href="#play">PLAY</a><a href="#worlds">WORLDS</a><a href="#how">HOW IT WORKS</a></nav>
        <div className="connection"><Wifi size={14} /><span>SENSORS ONLINE</span><i /></div>
      </header>

      <section className="home-hero" id="play">
        <div className="hero-copy">
          <div className="boot-line"><span>PLAYER 01 READY</span><i /></div>
          <h1>MOVE YOUR<br />BODY.<span>SHIFT THE<br />WORLD.</span></h1>
          <p>A real-world movement game where every reach, turn, and squeeze powers your next adventure.</p>
          <div className="home-actions">
            <Link className="pixel-primary" href="/dashboard"><span>START SESSION</span><ArrowRight size={18} /></Link>
            <button className="pixel-secondary"><CirclePlay size={20} /><span>WATCH GAMEPLAY</span></button>
          </div>
          <div className="player-strip">
            <div><b>03</b><span>GAME WORLDS</span></div><i /><div><b>1:1</b><span>LIVE MOVEMENT</span></div><i /><div><b>∞</b><span>WAYS TO LEVEL UP</span></div>
          </div>
        </div>

        <div className="portal-wrap">
          <div className="portal-top"><span>LIVE FEED // LEVEL 02</span><b>REC <i /></b></div>
          <PortalScene />
          <div className="portal-corners"><i /><i /><i /><i /></div>
          <div className="side-tag"><Crosshair size={13} /><span>MOVE TO AIM</span></div>
        </div>
      </section>

      <section className="world-ribbon" id="worlds">
        <span className="ribbon-title">CHOOSE YOUR NEXT WORLD</span>
        <Link href="/games/move"><i className="world-icon move">◆</i><span><small>WORLD 01</small><b>SKYWARD</b></span><em>MOVE</em></Link>
        <Link href="/games/steer"><i className="world-icon steer">▰</i><span><small>WORLD 02</small><b>NEON CIRCUIT</b></span><em>STEER</em></Link>
        <Link href="/games/control"><i className="world-icon control">✦</i><span><small>WORLD 03</small><b>GRIP TEMPLE</b></span><em>CONTROL</em></Link>
      </section>

      <footer className="home-footer"><span>HTN // BUILD 0.8.4</span><b><i /> PRESS START TO BEGIN</b><span>TORONTO, ON</span></footer>
    </main>
  );
}
