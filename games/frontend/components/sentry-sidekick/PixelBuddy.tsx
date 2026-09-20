"use client";

type Mood = "idle" | "alert" | "ok" | "think";

export default function Beety({ mood = "idle" }: { mood?: Mood }) {
  return (
    <div className={`pixel-beety mood-${mood}`} aria-hidden="true">
      <img
        src="/rehab-guardian/beety.gif"
        alt=""
        width={280}
        height={240}
        draggable={false}
      />
    </div>
  );
}
