"use client";

import { ArrowRight, ChevronDown, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

const worlds = [
  { id: "velocity", label: "Velocity", number: "01", color: "#ff4f7b" },
  { id: "blocks", label: "Blockfall", number: "02", color: "#33e7ff" },
  { id: "wilds", label: "The Wilds", number: "03", color: "#ffcf4a" }
];

function PixelLogo() {
  return <span className="pixel-logo" aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

function RacingWorld() {
  return (
    <div className="world racing-world">
      <div className="racing-sun" />
      <div className="racing-sky-lines" />
      <div className="cityscape" aria-hidden="true">
        {Array.from({ length: 15 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
      </div>
      <div className="mountains"><i /><i /><i /></div>
      <div className="road"><span className="road-line l1" /><span className="road-line l2" /><span className="road-line l3" /></div>
      <div className="pixel-car car-one"><span className="car-wing" /><span className="car-body" /><i className="wheel left" /><i className="wheel right" /><b>88</b></div>
      <div className="pixel-car car-two"><span className="car-wing" /><span className="car-body" /><i className="wheel left" /><i className="wheel right" /></div>
      <div className="speed-lines">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
    </div>
  );
}

const blockColors = ["cyan", "pink", "yellow", "violet", "orange"];

function BlocksWorld() {
  return (
    <div className="world blocks-world">
      <div className="block-horizon" /><div className="block-grid" />
      <div className="falling-pieces" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <div className={`fall-piece fp-${index + 1} ${blockColors[index % blockColors.length]}`} key={index}><i /><i /><i /><i /></div>
        ))}
      </div>
      <div className="block-stack" aria-hidden="true">
        {Array.from({ length: 54 }, (_, index) => <i className={blockColors[(index * 3) % blockColors.length]} key={index} />)}
      </div>
      <div className="clear-flash" />
    </div>
  );
}

function PineTree({ className }: { className: string }) {
  return <span className={`pine ${className}`} aria-hidden="true"><i /><i /><i /><b /></span>;
}

function WildsWorld() {
  return (
    <div className="world wilds-world">
      <div className="wild-sun" /><div className="cloud cloud-one" /><div className="cloud cloud-two" />
      <div className="far-mountains"><i /><i /><i /><i /></div><div className="near-mountains"><i /><i /><i /></div>
      <div className="castle"><i /><i /><i /><b /><span /></div>
      <div className="forest-back">{Array.from({ length: 18 }, (_, index) => <PineTree className={`tree-${index + 1}`} key={index} />)}</div>
      <div className="grassland" /><div className="path" />
      <div className="hero-character"><i className="head" /><i className="body" /><i className="shield" /><i className="sword" /></div>
      <div className="fireflies">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>
    </div>
  );
}

export default function HomePage() {
  const [activeWorld, setActiveWorld] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => setActiveWorld((current) => (current + 1) % worlds.length), 6500);
    return () => window.clearInterval(interval);
  }, [paused]);

  return (
    <main className="intro-page">
      <div className="worlds" data-active={worlds[activeWorld].id}><RacingWorld /><BlocksWorld /><WildsWorld /></div>
      <div className="pixel-noise" /><div className="vignette" />

      <header className="intro-header">
        <a className="brand" href="#top" aria-label="Pixel Verse home"><PixelLogo /><b>PIXEL<span>VERSE</span></b></a>
        <nav aria-label="Primary navigation"><a href="#worlds">Worlds</a><a href="#about">About</a><a href="#news">News</a></nav>
        <button className="sound-button" onClick={() => setPaused((current) => !current)} aria-label={paused ? "Resume scene transitions" : "Pause scene transitions"}>
          {paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? "RESUME" : "PAUSE"}</span>
        </button>
      </header>

      <section className="intro-content" id="top">
        <div className="edition"><i /> A UNIVERSE BUILT FROM PIXELS</div>
        <h1>PRESS START<br /><span>ANYWHERE.</span></h1>
        <p>Race through midnight. Stack beyond the skyline. Wander where the wild things grow. One portal, endless worlds.</p>
        <div className="intro-actions">
          <button className="start-button"><span>ENTER THE ARCADE</span><ArrowRight size={19} /></button>
          <button className="trailer-button"><i>▶</i><span>WATCH TRAILER</span></button>
        </div>
      </section>

      <div className="world-switcher" id="worlds">
        {worlds.map((world, index) => (
          <button className={activeWorld === index ? "active" : ""} onClick={() => setActiveWorld(index)} key={world.id}>
            <span>{world.number}</span><b>{world.label}</b><i><em style={{ background: world.color }} /></i>
          </button>
        ))}
      </div>

      <div className="scene-label"><span>NOW ENTERING</span><b>{worlds[activeWorld].label}</b></div>
      <a className="scroll-cue" href="#worlds"><span>EXPLORE WORLDS</span><ChevronDown size={16} /></a>
      <footer><span>© 2026 PIXELVERSE</span><span className="server"><i /> ALL SYSTEMS ONLINE</span><span>MADE FOR PLAYERS</span></footer>
    </main>
  );
}
