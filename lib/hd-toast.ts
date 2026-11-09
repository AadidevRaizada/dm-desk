"use client";

import { gooeyToast as baseToast } from "goey-toast";
import { sfx } from "@/lib/handdrawn";

/**
 * goey-toast with the hand-drawn sound kit: every error toast plays "no".
 * (Sound is off unless the user switched it on in the header.)
 * Success sounds are played at the action itself ("yes" for go live, "sent" for a DM).
 */
export const gooeyToast: typeof baseToast = Object.assign(
  (title: string, options?: Parameters<typeof baseToast>[1]) =>
    baseToast(title, options),
  baseToast,
  {
    error: (title: string, options?: Parameters<typeof baseToast.error>[1]) => {
      sfx("no");
      return baseToast.error(title, options);
    },
  },
);
