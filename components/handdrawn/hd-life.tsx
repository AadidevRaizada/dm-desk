"use client";

import { useEffect } from "react";
import { startBoil, wireClickFeel } from "@/lib/handdrawn";

let started = false;

/**
 * Starts the hand-drawn kit once per page load: the line "boil" on `.sk`
 * illustrations and the click feel (press tock, burst on `.clicky`, squeak on
 * `.hd-hit` critters). Sound stays off until the header toggle turns it on.
 */
export default function HdLife() {
  useEffect(() => {
    if (started) return;
    started = true;
    startBoil();
    wireClickFeel();
  }, []);
  return null;
}
