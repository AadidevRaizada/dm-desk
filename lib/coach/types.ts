/**
 * Coach v2 shared types (client-safe: no server imports).
 *
 * Every reel is a story: HOOK -> CONTENT -> (RE-HOOK -> CONTENT ->) PAYOFF,
 * and the payoff carries the creator's CTA. Results are saved as
 * CoachAnalysis rows (kind "fix" | "write" | "analyze") so a reel is coached
 * once, not regenerated on every visit.
 */

import type { Story } from "@/lib/hook-coach-story";

export interface CoachPersonaData {
  id: string;
  name: string;
  emoji: string;
  description: string;
  instructions: string;
  isDefault: boolean;
  sortOrder: number;
}

/** A low / likely / high range, all values 0-1. */
export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface ExpectedRetention {
  /** Share of viewers still watching after 3 seconds. */
  hold3s: Range | null;
  /** Average watch time as a share of the reel's length (can exceed 1 with loops; clamped to 1). */
  avgWatchPct: Range | null;
  /** One or two sentences: where this sits in his own numbers and why. */
  basis: string;
  /** What the reel actually did, for "Was 36% -> expected 52-60%". */
  actual?: { hold3s: number | null; avgWatchPct: number | null };
}

export type StoryWithRetention = Story & { expectedRetention?: ExpectedRetention };

export type FixProblem = "hook" | "content" | "payoff" | "unknown";

export interface FixResult {
  diagnosis?: string;
  problem?: FixProblem;
  stories: StoryWithRetention[];
}

export interface WriteInput {
  idea: string;
  length: "short" | "long";
}

export interface WriteResult {
  stories: StoryWithRetention[];
}

export interface AnalyzeSection {
  label: string;
  /** Seconds from the start. */
  start: number;
  end: number;
  note: string;
  change?: string;
}

export interface CtaScript {
  text: string;
  /** Where in the reel to say it, seconds from the start. */
  placementSec: number | null;
}

export type AnalyzeStage =
  | "queued"
  | "downloading"
  | "frames"
  | "transcribing"
  | "thinking";

export interface AnalyzeResult {
  status: "pending" | "done" | "error";
  stage?: AnalyzeStage;
  startedAt?: string;
  error?: string;
  score?: number;
  verdict?: string;
  summary?: string;
  sections?: AnalyzeSection[];
  viralHooks?: string[];
  ctaScripts?: CtaScript[];
  durationSec?: number | null;
  frameCount?: number;
  /** False when whisper.cpp wasn't available or the reel has no speech. */
  transcribed?: boolean;
  transcriptNote?: string;
}

export interface AnalyzeInput {
  source: "reel" | "upload";
  mediaId?: string;
  uploadId?: string;
  fileName?: string;
  caption?: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
}

export type CoachKind = "fix" | "write" | "analyze";

export interface SavedAnalysis {
  id: string;
  kind: CoachKind;
  mediaId: string | null;
  personaId: string | null;
  input: unknown;
  result: unknown;
  expectedRetention: unknown;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  personaId: string | null;
  updatedAt: string;
}

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: { analyzeMediaId?: string; analysisId?: string } | null;
  createdAt: string;
}

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export const SUGGESTED_PROMPTS = [
  "What should I post next?",
  "Why didn't my last reel work?",
  "Give me hook ideas",
];

/** "0:06" style label. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "–";
  }
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const pctLabel = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

export function rangeLabel(r: Range | null | undefined): string {
  if (!r) return "–";
  const lo = Math.round(r.low * 100);
  const hi = Math.round(r.high * 100);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}
