import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Gamepad2,
  Gauge,
  Home,
  Map,
  Move,
  Settings,
  Sparkles,
  Trophy,
  Zap,
  Crosshair
} from "lucide-react";
import Link from "next/link";

const worlds = [
  {
    slug: "move",
    title: "Skyward",
    subtitle: "Skyward Journey",
    icon: Move,
    status: "AVAILABLE",
    progress: "62%"
  },
  {
    slug: "steer",
    title: "Pulse Circuit",
    subtitle: "Master the road",
    icon: Gauge,
    status: "CONTINUE",
    progress: "84%"
  },
  {
    slug: "control",
    title: "Control",
    subtitle: "Squeeze + Steer",
    icon: Zap,
    status: "AVAILABLE",
    progress: "0%"
  },
  {
    slug: "paintball",
    title: "Inkburst",
    subtitle: "Squeeze, aim, splat",
    icon: Crosshair,
    status: "AVAILABLE",
    progress: "0%"
  }
];

export default function DashboardPage() {
  return (
    <main className="portal-dashboard">
      <div className="crt-layer" />
      <aside className="portal-side">
        <Link className="portal-side-logo" href="/" aria-label="Pulse Verse home">
          <span className="pixel-mark" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        </Link>
        <nav aria-label="Dashboard navigation">
          <Link href="/" aria-label="Home"><Home size={18} /></Link>
          <Link className="active" href="/dashboard" aria-label="Worlds"><Map size={18} /></Link>
          <Link href="/games/steer" aria-label="Play"><Gamepad2 size={18} /></Link>
          <button aria-label="Settings"><Settings size={18} /></button>
        </nav>
        <span className="portal-avatar">P1</span>
      </aside>

      <div className="portal-dashboard-main">
        <header className="portal-dashboard-top">
          <Link href="/"><ArrowLeft size={14} /> BACK TO PORTAL</Link>
          <div><span>PLAYER 01</span><b>LEVEL 08</b><i>P1</i></div>
        </header>

        <div className="portal-dashboard-grid">
          <section className="portal-dashboard-content">
            <div className="portal-feature">
              <div className="portal-feature-copy">
                <span>CONTINUE YOUR JOURNEY</span>
                <h1>PULSE<br /><b>CIRCUIT</b></h1>
                <p>Hold your line through the shifting road and complete three clean laps.</p>
                <Link href="/games/steer">PLAY NOW <ArrowRight size={16} /></Link>
              </div>
              <div className="portal-feature-art" aria-hidden="true"><i /><i /><i /></div>
            </div>

            <section className="portal-worlds">
              <div className="portal-section-title"><div><span>YOUR WORLDS</span><h2>Choose a game</h2></div><small>2 OF 3 OPEN</small></div>
              <div className="portal-world-row">
                {worlds.map((world, index) => {
                  const Icon = world.icon;
                  const locked = world.status === "LOCKED";
                  const content = (
                    <>
                      <div className={`portal-card-art art-${world.slug}`}><span>0{index + 1}</span><Icon size={22} /></div>
                      <div className="portal-card-copy"><small>{world.status}</small><b>{world.title}</b><span>{world.subtitle}</span></div>
                      <div className="portal-card-progress"><i style={{ width: world.progress }} /><span>{world.progress}</span></div>
                    </>
                  );
                  return locked
                    ? <div className="portal-game-card locked" key={world.slug}>{content}</div>
                    : <Link className="portal-game-card" href={`/games/${world.slug}`} key={world.slug}>{content}</Link>;
                })}
              </div>
            </section>

            <section className="portal-progress">
              <div className="portal-section-title"><div><span>YOUR PROGRESS</span><h2>Movement this month</h2></div><small>SEPTEMBER</small></div>
              <div className="portal-progress-grid">
                <div className="portal-progress-stats">
                  <span><i><Trophy size={15} /></i><small>BEST STREAK</small><b>8 DAYS</b></span>
                  <span><i><ChartNoAxesColumnIncreasing size={15} /></i><small>ACCURACY</small><b>82%</b></span>
                  <span><i><Sparkles size={15} /></i><small>SESSIONS</small><b>24</b></span>
                </div>
                <div className="portal-chart" aria-label="Monthly movement progress chart">
                  <svg viewBox="0 0 500 120" preserveAspectRatio="none"><path d="M0 92 C42 82 53 37 94 50 S151 99 194 76 S248 42 284 66 S345 93 379 55 S438 67 500 15" /><path className="fill" d="M0 92 C42 82 53 37 94 50 S151 99 194 76 S248 42 284 66 S345 93 379 55 S438 67 500 15 V120 H0Z" /></svg>
                  <div><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div>
                </div>
              </div>
            </section>
          </section>

          <aside className="portal-dashboard-rail">
            <section className="portal-rail-heading"><span>JOURNEY</span><b>Alex Morgan</b><small>Explorer · Level 08</small></section>
            <section className="portal-next-session">
              <div><span>NEXT SESSION</span><CalendarDays size={17} /></div>
              <b>Tomorrow</b><strong>10:30 AM</strong><p>Upper-body mobility<br />25 minute session</p>
              <button>VIEW DETAILS <ArrowRight size={13} /></button>
            </section>
            <section className="portal-quest">
              <span>DAILY QUEST</span><i><Sparkles size={18} /></i><b>Smooth Operator</b>
              <p>Finish a run with 80% movement accuracy.</p>
              <div><i /><span>72%</span></div>
            </section>
            <section className="portal-rail-stats"><span><small>XP EARNED</small><b>2,840</b></span><span><small>WORLDS</small><b>02 / 03</b></span></section>
          </aside>
        </div>
      </div>
    </main>
  );
}
