/**
 * Turns a saved Coach result into a self-contained prompt the creator can paste
 * into Claude (or any assistant) to produce the reel. Client-safe.
 */
import { BEAT_LABELS, storyDuration, type Story } from "@/lib/hook-coach-story";
import {
  clock,
  rangeLabel,
  type AnalyzeInput,
  type AnalyzeResult,
  type CoachPersonaData,
  type ExpectedRetention,
  type FixResult,
  type SavedAnalysis,
  type StoryWithRetention,
  type WriteInput,
  type WriteResult,
} from "@/lib/coach/types";

const STRUCTURE =
  "Every reel is a story: HOOK → CONTENT → PAYOFF. Longer reels chain open loops: HOOK → CONTENT → RE-HOOK → CONTENT → … → PAYOFF. The hook gets them in, the content is interesting enough that they wait, and the payoff delivers the takeaway plus the CTA.";

function pct(v: number | null | undefined): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "unknown";
}

function retentionLines(r: ExpectedRetention | null | undefined): string[] {
  if (!r) return [];
  const out = ["## Expected retention (from my own past reels)"];
  if (r.actual?.hold3s != null) out.push(`- Actual 3-second hold: ${pct(r.actual.hold3s)}`);
  if (r.hold3s) out.push(`- Expected 3-second hold: ${rangeLabel(r.hold3s)}`);
  if (r.avgWatchPct) out.push(`- Expected average watch: ${rangeLabel(r.avgWatchPct)} of the reel`);
  if (r.basis) out.push(`- Why: ${r.basis}`);
  out.push("");
  return out;
}

function storyLines(story: StoryWithRetention, heading: string): string[] {
  const total = storyDuration(story as Story);
  const out = [`## ${heading}: ${story.title}${total !== null ? ` (~${Math.round(total)}s)` : ""}`];
  for (const beat of story.beats) {
    const secs = typeof beat.seconds === "number" ? ` · ${beat.seconds}s` : "";
    out.push(`**${BEAT_LABELS[beat.type]}${secs}**: ${beat.text}`);
    if (beat.onScreenText) out.push(`  On screen: "${beat.onScreenText}"`);
  }
  if (story.cta) out.push(`**CTA**: ${story.cta}`);
  if (story.whyItWorks) out.push(`Why it works: ${story.whyItWorks}`);
  if (story.styleBorrowedFrom) out.push(`Style: ${story.styleBorrowedFrom}`);
  out.push("");
  out.push(...retentionLines(story.expectedRetention));
  return out;
}

const ASK_SCRIPT = [
  "## What I need from you",
  "Using everything above, produce a ready-to-shoot reel:",
  "1. The final script, beat by beat, with timestamps.",
  "2. On-screen text for each beat (short, readable in under 1.5s).",
  "3. A shot list / B-roll ideas for each beat.",
  "4. The caption (first line = the hook) and up to 5 hashtags.",
  "5. A cover/thumbnail text idea.",
  "Keep the hook under 12 words and make sure the payoff ends with the CTA.",
];

export function analysisToPrompt(
  analysis: SavedAnalysis,
  persona?: CoachPersonaData | null
): string {
  const lines: string[] = ["# Reel brief from DM Desk Coach", "", STRUCTURE, ""];
  if (persona) {
    lines.push(`Coach persona used: ${persona.emoji} ${persona.name}: ${persona.description}`, "");
  }

  if (analysis.kind === "analyze") {
    const input = (analysis.input ?? {}) as AnalyzeInput;
    const r = (analysis.result ?? {}) as AnalyzeResult;
    lines.push("## The reel that was reviewed");
    if (input.permalink) lines.push(`- Link: ${input.permalink}`);
    if (input.fileName) lines.push(`- File: ${input.fileName} (checked before posting)`);
    if (input.caption) lines.push(`- Caption: ${input.caption.replace(/\s+/g, " ").slice(0, 300)}`);
    if (r.durationSec) lines.push(`- Length: ${clock(r.durationSec)}`);
    if (typeof r.score === "number") lines.push(`- Score: ${r.score.toFixed(1)}/5 (${r.verdict ?? ""})`);
    lines.push("");
    if (r.summary) lines.push("## Summary", r.summary, "");
    if (r.sections?.length) {
      lines.push("## Second by second");
      for (const s of r.sections) {
        lines.push(`- **${s.label}** (${clock(s.start)}–${clock(s.end)}): ${s.note}`);
        if (s.change) lines.push(`  → Change: ${s.change}`);
      }
      lines.push("");
    }
    if (r.viralHooks?.length) {
      lines.push("## Hooks that would have worked better");
      r.viralHooks.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
      lines.push("");
    }
    if (r.ctaScripts?.length) {
      lines.push("## CTA scripts");
      for (const c of r.ctaScripts) {
        lines.push(`- ${c.text}${c.placementSec != null ? ` (say it at ${clock(c.placementSec)})` : ""}`);
      }
      lines.push("");
    }
    lines.push(...retentionLines(analysis.expectedRetention as ExpectedRetention | null));
    lines.push(
      "## What I need from you",
      "Remake this reel using the review above: keep what works, apply every change, open with the strongest hook from the list, and add a re-hook wherever viewers drop. Give me:",
      ...ASK_SCRIPT.slice(2)
    );
    return lines.join("\n").trim();
  }

  if (analysis.kind === "fix") {
    const r = (analysis.result ?? {}) as FixResult;
    const input = (analysis.input ?? {}) as { caption?: string; permalink?: string };
    lines.push("## The reel being fixed");
    if (input.permalink) lines.push(`- Link: ${input.permalink}`);
    if (input.caption) lines.push(`- Original hook/caption: ${input.caption.replace(/\s+/g, " ").slice(0, 300)}`);
    if (r.problem && r.problem !== "unknown") lines.push(`- Main problem: the ${r.problem}`);
    lines.push("");
    if (r.diagnosis) lines.push("## Diagnosis", r.diagnosis, "");
    (r.stories ?? []).forEach((s, i) =>
      lines.push(...storyLines(s, r.stories.length > 1 ? `Rewrite ${i + 1}` : "Rewrite"))
    );
    lines.push(...ASK_SCRIPT);
    return lines.join("\n").trim();
  }

  // write
  const input = (analysis.input ?? {}) as WriteInput;
  const r = (analysis.result ?? {}) as WriteResult;
  lines.push("## The idea", input.idea ?? "", `Length: ${input.length === "long" ? "45–90s" : "15–30s"}`, "");
  (r.stories ?? []).forEach((s, i) => lines.push(...storyLines(s, `Option ${i + 1}`)));
  lines.push(...ASK_SCRIPT, "Pick the strongest option (or combine them) and say which one you chose and why.");
  return lines.join("\n").trim();
}
