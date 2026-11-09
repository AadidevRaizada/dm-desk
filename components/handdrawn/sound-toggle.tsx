"use client";

import { useEffect, useState } from "react";
import { setSound, soundIsOn } from "@/lib/handdrawn";
import { cn } from "@/lib/utils";

/** Header switch for the little sound effects. Off by default, remembered per device. */
export default function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // Read the saved choice after mount so the server render always says "off".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(soundIsOn());
  }, []);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        setSound(!on);
        setOn(!on);
      }}
      className={cn(
        "hr2 shrink-0 whitespace-nowrap border-2 border-ink bg-paper2 px-2.5 py-0.5 font-display text-base leading-tight hover:bg-wash",
        className,
      )}
      title={on ? "Turn sound off" : "Turn sound on"}
    >
      Sound: {on ? "on" : "off"}
    </button>
  );
}
