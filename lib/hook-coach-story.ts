/**
 * Hook Coach shared types and helpers (client-safe: no server imports).
 *
 * Every reel is a story: HOOK -> CONTENT -> PAYOFF. Longer reels chain
 * re-hooks (open loops) between content beats before the payoff.
 */

export const DEFAULT_REFERENCES = [
  "Ankur Warikoo",
  "Raj Shamani",
  "Varun Mayya",
  "Dhruv Rathee",
  "Alex Hormozi",
  "Ali Abdaal",
  "MrBeast (retention structure)",
  "Nischa Shah",
];

export const MAX_REFERENCES = 15;

export interface HookCoachProfileData {
  niche: string;
  audience: string;
  cta: string;
  references: string[];
  /** False until the workspace saves a profile (references are defaults). */
  saved: boolean;
}

export const BEAT_TYPES = ["hook", "content", "rehook", "payoff"] as const;
export type BeatType = (typeof BEAT_TYPES)[number];

export interface StoryBeat {
  type: BeatType;
  text: string;
  onScreenText?: string;
  seconds?: number;
}

export interface Story {
  title: string;
  beats: StoryBeat[];
  cta: string;
  whyItWorks: string;
  styleBorrowedFrom: string;
}

export type StoryLength = "short" | "long";

export const BEAT_LABELS: Record<BeatType, string> = {
  hook: "Hook",
  content: "Content",
  rehook: "Re-hook",
  payoff: "Payoff",
};

export function storyDuration(story: Story): number | null {
  const secs = story.beats
    .map((b) => b.seconds)
    .filter((s): s is number => typeof s === "number");
  return secs.length > 0 ? secs.reduce((a, b) => a + b, 0) : null;
}

/** Full script as plain text, ready to paste into notes or a teleprompter. */
export function storyToScript(story: Story): string {
  const total = storyDuration(story);
  const lines = [
    story.title + (total !== null ? ` (~${Math.round(total)}s)` : ""),
    "",
  ];
  for (const beat of story.beats) {
    const secs = typeof beat.seconds === "number" ? ` · ${beat.seconds}s` : "";
    lines.push(`[${BEAT_LABELS[beat.type].toUpperCase()}${secs}]`);
    lines.push(beat.text);
    if (beat.onScreenText) lines.push(`On screen: ${beat.onScreenText}`);
    lines.push("");
  }
  if (story.cta) lines.push(`CTA: ${story.cta}`);
  return lines.join("\n").trim();
}
