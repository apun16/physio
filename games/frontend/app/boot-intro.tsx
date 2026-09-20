"use client";

import { useEffect, useState } from "react";

export default function BootIntro() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), 3900);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="boot-intro"
      role="status"
      aria-label="RePlay starting"
      onClick={() => setVisible(false)}
    >
      <div className="boot-stars" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
      </div>
      <div className="boot-bloom" aria-hidden="true"><i /><i /><i /></div>
      <div className="boot-cube" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </div>
      <div className="boot-wordmark">
        <span>Re<b>Play</b></span>
      </div>
      <div className="boot-ready">MOVEMENT SYSTEM ONLINE</div>
      <button type="button" onClick={() => setVisible(false)}>SKIP</button>
    </div>
  );
}
