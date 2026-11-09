/**
 * JSON shapes shared by the strategy API and the /schedule UI.
 * Pure types + tiny helpers: safe for client components.
 */

import type { ExperimentStatus, TestVariable } from "@/lib/strategy/config";
import type { DecisionOutcome, RatioSet } from "@/lib/strategy/score";
import type { PlanDay } from "@/lib/strategy/cadence";

export interface VariantPlan {
  label: string;
  hook: string | null;
  trimStartSec: number;
  maxDurationSec: number | null;
  coverOffsetMs: number;
  caption: string | null;
}

/** Stored on StrategyExperiment.plan. */
export interface ExperimentPlan {
  startAt: string;
  hookPosition?: "top" | "middle";
  caption: string;
  shareToFeed: boolean;
  trial: boolean;
  source: { uploadId: string } | { mediaId: string };
  sourceRelPath: string;
  variants: VariantPlan[];
  progress: { done: number; total: number };
}

export interface VariantScoreView {
  postId: string;
  label: string;
  score: number | null;
  reach: number | null;
  eligible: boolean;
  ratios: RatioSet;
  pct: RatioSet;
}

/** Stored on StrategyExperiment.decision. */
export interface StoredDecision {
  outcome: DecisionOutcome;
  reason: string;
  winnerId: string | null;
  margin: number | null;
  coreWins: number | null;
  coreNeeded: number | null;
  nextVariable: TestVariable | null;
  nextReason: string | null;
  components: string[];
  scores: VariantScoreView[];
  reference: "trials" | "reels" | "batch";
  ageHours: number;
  evaluatedAt: string;
  /** Repost experiments: the original reel's score in the same pool. */
  originalScore?: number | null;
  sharedAt?: string | null;
  repostedPostId?: string | null;
  repulledAt?: string | null;
}

/** Latest + per-checkpoint insights stored on ScheduledPost.metrics. */
export interface PostMetrics {
  reach: number | null;
  views: number | null;
  likes: number | null;
  saved: number | null;
  shares: number | null;
  avgWatchMs: number | null;
  skipRate: number | null;
  checkpoints: Record<string, Omit<PostMetrics, "checkpoints"> & { at: string }>;
}

export interface VariantView {
  id: string;
  label: string;
  hook: string | null;
  caption: string;
  status: string;
  scheduledAt: string;
  publishedAt: string | null;
  permalink: string | null;
  error: string | null;
  hasCover: boolean;
  durationSec: number | null;
  metrics: PostMetrics | null;
  metricsAt: string | null;
  graduatedAt: string | null;
  trial: boolean;
}

export interface ExperimentView {
  id: string;
  kind: "ab_test" | "repost";
  name: string;
  variable: TestVariable;
  status: ExperimentStatus;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  winnerPostId: string | null;
  decision: StoredDecision | null;
  progress: { done: number; total: number } | null;
  startAt: string | null;
  sourceMediaId: string | null;
  variants: VariantView[];
}

export type MoveAction =
  | { type: "remix"; mediaId: string }
  | { type: "test_hooks"; mediaId: string | null; idea: string | null }
  | { type: "push_winner"; experimentId: string; permalink: string | null }
  | { type: "plan_post"; at: string; captionSeed: string | null }
  | { type: "open_queue" };

export interface Move {
  id: string;
  kind: "push_winner" | "warning" | "fill_week" | "part2" | "remix" | "test_hooks";
  title: string;
  reason: string;
  cta: string;
  priority: number;
  action: MoveAction;
}

export interface ReelOption {
  id: string;
  hook: string;
  timestamp: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  reach: number | null;
  hold3s: number | null;
  sharesPerReach: number | null;
  avgWatchSec: number | null;
  repostable: boolean;
  /** Earliest repost time when repostable (ISO). */
  repostAt: string | null;
  repostReason: string | null;
}

export interface StrategyData {
  timeZone: string;
  generatedAt: string;
  insights: "ok" | "no_account" | "error";
  insightsMessage: string | null;
  plan: {
    days: PlanDay[];
    mainCount: number;
    target: number;
    openSlots: string[];
    warnings: string[];
    slotsNote: string;
    slotsSource: "own" | "generic";
  };
  moves: Move[];
  experiments: ExperimentView[];
  reels: ReelOption[];
  /** Next suggested start for a hook test / a main reel (ISO). */
  nextTestSlot: string;
  nextMainSlot: string;
  testBatchesThisWeek: number;
  limits: { maxVariants: number; maxBatchesPerWeek: number; staggerMin: number };
}

export const isTerminal = (s: ExperimentStatus) =>
  s === "decided" || s === "no_winner" || s === "cancelled";
