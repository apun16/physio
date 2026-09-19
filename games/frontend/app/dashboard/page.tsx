import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Gauge,
  HeartPulse,
  Lock,
  Move,
  Play,
  Sparkles,
  Timer,
  Trophy,
  Zap
} from "lucide-react";
import Link from "next/link";

type LevelStatus = "ready" | "calibrate" | "locked";

const levels = [
  {
    slug: "move",
    number: "01",
    title: "Move",
    subtitle: "Skyward Journey",
    description: "Walk the woods automatically and use sword, shield, and bow when enemies step in.",
    icon: Move,
    accent: "move",
    status: "ready" as LevelStatus,
    cta: "Play Now",
    tags: ["Range", "Trajectory"]
  },
  {
    slug: "steer",
    number: "02",
    title: "Steer",
    subtitle: "Pulse Circuit",
    description: "Drive the course and compare your line against the optimal movement path.",
    icon: Gauge,
    accent: "steer",
    status: "ready" as LevelStatus,
    cta: "Play Now",
    tags: ["Steering", "Accuracy"]
  },
  {
    slug: "control",
    number: "03",
    title: "Control",
    subtitle: "Squeeze + Steer",
    description: "Combine grip force and movement to test strength, timing, and coordination.",
    icon: Zap,
    accent: "control",
    status: "locked" as LevelStatus,
    cta: "Locked",
    tags: ["Force", "Coordination"]
  }
];

const statusCopy: Record<LevelStatus, string> = {
  ready: "Ready to play",
  calibrate: "Calibration ready",
  locked: "Finish Steer first"
};

export default function DashboardPage() {
  return (
    <main className="dash">
      <header className="dash-top dashboard-topbar">
        <div className="dashboard-brand">
          <Link className="dash-back" href="/"><ArrowLeft size={16} /> Intro</Link>
          <span className="top-divider" />
          <span className="logo-mark small" aria-hidden="true" />
          <span className="logo-word">Pulse<b>Verse</b></span>
        </div>
        <div className="dashboard-user">
          <button className="notification-button" aria-label="Notifications"><Bell size={17} /><i /></button>
          <div className="user-copy"><strong>Alex Morgan</strong><span>Level 8</span></div>
          <span className="user-avatar">AM</span>
        </div>
      </header>

      <div className="dashboard-wrap">
        <section className="welcome-panel">
          <div className="welcome-copy">
            <span className="intro-kicker">Tuesday training plan</span>
            <h1>Ready to move?</h1>
            <p>Your next session is calibrated and waiting. Pick up where you left off or choose another level.</p>
            <div className="welcome-actions">
              <Link href="/games/steer"><Play size={16} fill="currentColor" /> Continue session</Link>
              <button>View progress <ArrowRight size={15} /></button>
            </div>
          </div>
          <div className="weekly-goal">
            <div className="goal-ring"><span><b>4</b><small>OF 5</small></span></div>
            <div><span>WEEKLY GOAL</span><strong>One session to go</strong><small>Great consistency this week</small></div>
          </div>
          <div className="hero-pulse" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        </section>

        <section className="metric-row" aria-label="Training overview">
          <article><span className="metric-icon cyan"><Activity size={18} /></span><div><small>SESSIONS</small><strong>24</strong></div><em>+3 this week</em></article>
          <article><span className="metric-icon pink"><Timer size={18} /></span><div><small>TRAINING TIME</small><strong>6h 40m</strong></div><em>32m average</em></article>
          <article><span className="metric-icon yellow"><Trophy size={18} /></span><div><small>BEST STREAK</small><strong>8 days</strong></div><em>Personal best</em></article>
          <article><span className="metric-icon violet"><ChartNoAxesColumnIncreasing size={18} /></span><div><small>ACCURACY</small><strong>82%</strong></div><em className="positive">↑ 6%</em></article>
        </section>

        <div className="dashboard-body">
          <section className="levels-section">
            <div className="section-heading"><div><span>TRAINING WORLDS</span><h2>Choose your level</h2></div><button>View all <ArrowRight size={14} /></button></div>
            <div className="level-grid dashboard-level-grid">
              {levels.map((level) => {
                const Icon = level.icon;
                const locked = level.status === "locked";
                const className = `level-card accent-${level.accent} status-${level.status}`;
                const content = (
                  <>
                    <span className={`level-motif motif-${level.accent}`} aria-hidden="true" />
                    <div className="level-card-head"><span className="level-number">LEVEL {level.number}</span><span className="level-status">{locked ? <Lock size={11} /> : <Sparkles size={11} />}{statusCopy[level.status]}</span></div>
                    <span className="level-icon"><Icon size={24} /></span>
                    <h2>{level.title}</h2><span className="level-subtitle">{level.subtitle}</span><p>{level.description}</p>
                    <div className="level-tags">{level.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <span className="level-cta">{level.cta}{locked ? <Lock size={15} /> : <ArrowRight size={15} />}</span>
                  </>
                );
                return locked ? <div className={className} key={level.slug}>{content}</div> : <Link className={className} href={`/games/${level.slug}`} key={level.slug}>{content}</Link>;
              })}
            </div>
          </section>

          <aside className="dashboard-rail">
            <section className="rail-card next-session">
              <div className="rail-heading"><span>NEXT SESSION</span><CalendarDays size={17} /></div>
              <strong>Tomorrow, 10:30 AM</strong><p>Upper-body mobility · 25 min</p>
              <div className="therapist"><span>DR</span><div><strong>Dr. Rivera</strong><small>Physiotherapist</small></div></div>
              <button>Session details <ArrowRight size={14} /></button>
            </section>

            <section className="rail-card daily-quest">
              <div className="rail-heading"><span>DAILY QUEST</span><Sparkles size={17} /></div>
              <div className="quest-gem"><HeartPulse size={24} /></div>
              <h3>Smooth Operator</h3><p>Complete a movement with 80% trajectory accuracy.</p>
              <div className="quest-progress"><div><i /></div><span>72%</span></div>
              <small>REWARD · 150 XP</small>
            </section>

            <section className="rail-card device-status">
              <div><i /><span><strong>Device connected</strong><small>IMU + Grip Sensor</small></span></div>
              <button>Manage</button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
