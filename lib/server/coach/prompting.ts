/**
 * Shared Coach prompting: the story philosophy, the persona + style profile
 * system prompt, his top/bottom posts as context, the rule-based diagnosis and
 * defensive JSON parsing. Used by fix/write, the reel analyzer and chat.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import type { HookData, HookPost } from "@/lib/server/hook-coach";
import { rankPosts } from "@/lib/server/hook-coach";
import {
  BEAT_TYPES,
  type BeatType,
  type HookCoachProfileData,
  type Story,
  type StoryBeat,
} from "@/lib/hook-coach-story";
import type { CoachPersonaData, FixProblem } from "@/lib/coach/types";

export const MODEL_ID = "claude-sonnet-5-5";
export const MAX_HOOK_WORDS = 12;

export function coachModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) return null;
  return createAnthropic({ apiKey })(MODEL_ID);
}

export const NO_KEY_MESSAGE =
  "The Coach isn't set up yet: ANTHROPIC_API_KEY is missing on the server.";

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

export const pct = (v: number | null, digits = 0) =>
  v === null ? "n/a" : `${(v * 100).toFixed(digits)}%`;

export const secs = (ms: number | null) =>
  ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;

export function median(values: Array<number | null>): number | null {
  const sorted = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function describePost(p: HookPost): string {
  return [
    `opening line: "${p.hook || "(no caption)"}"`,
    `type: ${p.isReel ? "reel" : p.mediaType.toLowerCase()}`,
    `posted: ${p.timestamp.slice(0, 10)}`,
    `3s hold: ${pct(p.hold3s)}`,
    `avg watch: ${secs(p.avgWatchTimeMs)}`,
    `(shares+saves)/reach: ${pct(p.spreadRate, 1)}`,
    `follows/reach: ${pct(p.followRate, 2)}`,
    `reach: ${p.reach ?? "n/a"}`,
  ].join(" | ");
}

export function contextBlock(data: HookData) {
  const { metric, ranked } = rankPosts(data.posts);
  const top = ranked.slice(0, 5);
  const bottom = ranked
    .slice(-5)
    .reverse()
    .filter((p) => !top.includes(p));
  const label = metric === "hold3s" ? "3-second hold" : "(shares+saves)/reach";
  const text = [
    `Creator: @${data.account.username}. Posts ranked by ${label}.`,
    "",
    "HIS TOP 5 POSTS (his voice at its best):",
    ...top.map((p, i) => `T${i + 1}. ${describePost(p)}`),
    "",
    "HIS BOTTOM 5 POSTS (what not to repeat):",
    ...bottom.map((p, i) => `B${i + 1}. ${describePost(p)}`),
  ].join("\n");
  return { text, hasData: top.length > 0 };
}

/**
 * Diagnose where a reel lost people, against the creator's own medians:
 * high skip rate = hook; low skip but short watch time = content sag (lost
 * before the payoff); both fine but low shares/saves = weak payoff.
 */
export function diagnose(
  post: HookPost,
  data: HookData
): { problem: FixProblem; signal: string } {
  const reels = data.posts.filter((p) => p.isReel);
  const medSkip = median(reels.map((p) => p.skipRate));
  const medWatch = median(reels.map((p) => p.avgWatchTimeMs));
  const medSpread = median(data.posts.map((p) => p.spreadRate));

  const weakSpread =
    post.spreadRate !== null &&
    medSpread !== null &&
    post.spreadRate < medSpread;
  const spreadNote = `(shares+saves)/reach ${pct(post.spreadRate, 1)} vs his median ${pct(medSpread, 1)}`;

  if (post.isReel && post.skipRate !== null && medSkip !== null) {
    if (post.skipRate > medSkip) {
      return {
        problem: "hook",
        signal: `HOOK PROBLEM. Skip rate ${pct(post.skipRate)} is above his median of ${pct(medSkip)}: people swipe away in the first 3 seconds. The first frame and opening line did not earn attention.`,
      };
    }
    if (
      post.avgWatchTimeMs !== null &&
      medWatch !== null &&
      post.avgWatchTimeMs < medWatch
    ) {
      return {
        problem: "content",
        signal: `CONTENT SAG. Skip rate ${pct(post.skipRate)} is at or below his median of ${pct(medSkip)}, so the hook worked, but avg watch time ${secs(post.avgWatchTimeMs)} is below his median of ${secs(medWatch)}: viewers left in the middle, before the payoff. The content did not keep the hook's promise alive (no open loop, no re-hook, too slow).`,
      };
    }
    if (weakSpread) {
      return {
        problem: "payoff",
        signal: `WEAK PAYOFF. Hook and watch time are at or better than his medians, but ${spreadNote}: people watched to the end and felt nothing worth saving or sending. The takeaway was not sharp or useful enough.`,
      };
    }
    return {
      problem: "unknown",
      signal:
        "Skip rate, watch time and shares/saves are all at or better than his medians. The story structure held; tighten every beat and make the payoff more quotable.",
    };
  }

  if (weakSpread) {
    return {
      problem: "payoff",
      signal: `No skip-rate data (not a reel, or Instagram didn't report it). ${spreadNote}: treat it as a WEAK PAYOFF and judge the opening line on its own.`,
    };
  }
  return {
    problem: "unknown",
    signal:
      "No skip-rate or watch-time data for this post. Judge the opening line, structure and payoff on their own against his top posts.",
  };
}

/* ------------------------------------------------------------------ */
/* System prompt                                                       */
/* ------------------------------------------------------------------ */

/** General, well-known techniques only. No quotes, no invented facts. */
const KNOWN_TECHNIQUES: Record<string, string> = {
  "ankur warikoo":
    "calm personal-finance and life-lesson storytelling; numbered lessons; 'I made this mistake so you don't have to' framing; simple everyday language",
  "raj shamani":
    "founder and podcast-clip energy; a bold claim up front, a story or guest insight in the middle, a crisp business lesson at the end",
  "varun mayya":
    "fast tech and AI explainers; contrarian opening, rapid cuts, 'here's what's actually happening' reveals",
  "dhruv rathee":
    "investigative explainer; a provocative question, evidence laid out step by step, a clear verdict; heavy on-screen text and visuals",
  "alex hormozi":
    "punchy business frameworks; very short sentences; big, specific outcome promises; lists and simple math; direct CTAs",
  "ali abdaal":
    "friendly, evidence-based productivity tips; 'here are 3 things' structure; warm and conversational with clearly labelled takeaways",
  mrbeast:
    "retention engineering: stakes clear in the first second, constant escalation, a new open loop before the last one closes, the payoff saved for the very end",
  "nischa shah":
    "clear, calm money explainers; a relatable scenario first, a structured breakdown, practical rules of thumb as the payoff",
};

function techniqueFor(name: string): string {
  const key = name.toLowerCase();
  for (const [known, technique] of Object.entries(KNOWN_TECHNIQUES)) {
    if (key.includes(known)) return technique;
  }
  return "the structure and pacing this creator is generally known for (if you don't know them well, borrow nothing specific)";
}

export const PHILOSOPHY = `PHILOSOPHY (non-negotiable):
- Every reel is a STORY: HOOK -> CONTENT -> PAYOFF.
- The HOOK gets viewers in. It is ${MAX_HOOK_WORDS} words or fewer and opens a question the viewer needs answered.
- The CONTENT must be interesting enough that they stay for the payoff: keep the hook's promise alive, show progress, no filler.
- The PAYOFF delivers the takeaway AND the creator's CTA.
- Longer reels chain open loops: HOOK -> CONTENT -> RE-HOOK -> CONTENT -> RE-HOOK -> CONTENT -> PAYOFF. A RE-HOOK is one line that teases what is still coming so they keep waiting for the payoff.`;

export function systemPrompt(
  profile: HookCoachProfileData,
  persona: CoachPersonaData,
  opts: { json?: boolean } = { json: true }
) {
  const refs = profile.references
    .map((r) => `- ${r}: ${techniqueFor(r)}`)
    .join("\n");
  const cta = profile.cta.trim();
  return `You are "${persona.name}", a short-form video coach for one Instagram creator. Be blunt, specific and practical.

YOUR ROLE (${persona.name}):
${persona.instructions.trim()}

${PHILOSOPHY}

STYLE: modelled on these creators in his space. Borrow structure and technique, never their words. Never invent quotes or facts about them.
${refs}

HIS PROFILE:
- Niche: ${profile.niche.trim() || "not set (infer it from his posts)"}
- Audience: ${profile.audience.trim() || "not set (infer it from his posts)"}
- CTA: ${cta ? `"${cta}" (put this in the payoff near-verbatim)` : 'NOT SET. Use a sensible generic CTA for his niche and mention he can set his own in "Your style".'}

Write in HIS voice: copy the rhythm, vocabulary and structure of his top posts, not generic guru phrasing.${
    opts.json === false
      ? ""
      : "\nReply with ONLY a JSON object, no markdown fences, no commentary."
  }`;
}

export const STORY_SHAPE = `{"title": "string", "beats": [{"type": "hook" | "content" | "rehook" | "payoff", "text": "what he says", "onScreenText": "optional short on-screen caption", "seconds": number}], "cta": "string", "whyItWorks": "one or two sentences", "styleBorrowedFrom": "which reference creator / technique, and which of his top posts (T1-T5) it borrows from"`;

/* ------------------------------------------------------------------ */
/* Defensive parsing                                                   */
/* ------------------------------------------------------------------ */

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const unquote = (s: string) => s.replace(/^["“]|["”]$/g, "").trim();

function normaliseBeatType(v: unknown): BeatType | null {
  const t = str(v).toLowerCase().replace(/[^a-z]/g, "");
  if ((BEAT_TYPES as readonly string[]).includes(t)) return t as BeatType;
  if (t === "reveal" || t === "openloop" || t === "loop") return "rehook";
  if (t === "body" || t === "story" || t === "setup") return "content";
  if (t === "cta" || t === "takeaway" || t === "ending") return "payoff";
  return null;
}

function cleanBeat(value: unknown): StoryBeat | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const type = normaliseBeatType(v.type);
  const text = unquote(str(v.text) || str(v.script) || str(v.line));
  if (!type || !text) return null;
  const beat: StoryBeat = { type, text };
  const onScreen = str(v.onScreenText) || str(v.on_screen_text);
  if (onScreen) beat.onScreenText = onScreen;
  const seconds = Number(v.seconds);
  if (Number.isFinite(seconds) && seconds > 0 && seconds < 120) {
    beat.seconds = Math.round(seconds);
  }
  return beat;
}

export function cleanStory(value: unknown, fallbackCta: string): Story | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const beats = Array.isArray(v.beats)
    ? v.beats.map(cleanBeat).filter((b): b is StoryBeat => b !== null)
    : [];
  if (beats.length < 2) return null;
  // A story always opens on a hook and closes on a payoff.
  if (beats[0].type !== "hook") beats[0] = { ...beats[0], type: "hook" };
  const last = beats.length - 1;
  if (beats[last].type !== "payoff") {
    beats[last] = { ...beats[last], type: "payoff" };
  }
  return {
    title: str(v.title) || unquote(beats[0].text),
    beats,
    cta: str(v.cta) || fallbackCta,
    whyItWorks: str(v.whyItWorks) || str(v.why),
    styleBorrowedFrom: str(v.styleBorrowedFrom) || str(v.style),
  };
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const slice = stripped.slice(start, end + 1);
  try {
    const parsed: unknown = JSON.parse(slice);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Common model slip: trailing commas.
    try {
      const parsed: unknown = JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

export const GARBLED = "The coach's answer came back garbled. Try again.";
