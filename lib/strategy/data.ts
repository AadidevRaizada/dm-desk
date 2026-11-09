/**
 * Loads everything the strategy section of /schedule needs: his reels with
 * numbers (Hook Coach data, cached 30 min), the queue, experiments, the week
 * plan, repost candidates and suggested moves. Server only.
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getHookData, type HookDataResult, type HookPost } from "@/lib/server/hook-coach";
import {
  bestSlots,
  findSlot,
  planWeek,
  type BestSlots,
  type PlanPostInput,
} from "@/lib/strategy/cadence";
import { repostCandidates, type ReelStat } from "@/lib/strategy/candidates";
import {
  DAY_MS,
  MAX_TEST_BATCHES_PER_WEEK,
  MAX_VARIANTS,
  REPOST_DEFAULT_GAP_DAYS,
  VARIANT_STAGGER_MIN,
  type ExperimentStatus,
  type TestVariable,
} from "@/lib/strategy/config";
import { getOlderReels } from "@/lib/strategy/library";
import { buildMoves } from "@/lib/strategy/suggest";
import { loadTags, tagReelsInBackground } from "@/lib/strategy/tags";
import type {
  ExperimentPlan,
  ExperimentView,
  PostMetrics,
  ReelOption,
  StoredDecision,
  StrategyData,
  VariantView,
} from "@/lib/strategy/types";

/** Stale "draft" (rendering) experiments are given up after this long. */
export const STALE_DRAFT_MS = 20 * 60_000;

export function strategyTimeZone(): string {
  return (
    process.env.STRATEGY_TIME_ZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

export function toReelStat(p: HookPost): ReelStat {
  return {
    id: p.id,
    timestamp: p.timestamp,
    hook: p.hook,
    caption: p.caption,
    permalink: p.permalink,
    thumbnailUrl: p.thumbnailUrl,
    reach: p.reach,
    shares: p.shares,
    saved: p.saved,
    likes: p.likes,
    avgWatchTimeMs: p.avgWatchTimeMs,
    skipRate: p.skipRate,
    hold3s: p.hold3s,
  };
}

const firstLine = (s: string | null | undefined, n = 40) => {
  const line = (s ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > n ? `${line.slice(0, n - 1)}…` : line || "Reel";
};

type PostRow = Prisma.ScheduledPostGetPayload<object>;

export function postsToPlan(rows: PostRow[], reels: HookPost[], now: Date): PlanPostInput[] {
  const scheduledMedia = new Set(rows.map((r) => r.mediaId).filter(Boolean));
  const fromQueue: PlanPostInput[] = rows.map((r) => ({
    id: r.id,
    at: r.publishedAt ?? r.scheduledAt,
    main: r.trialStrategy === null,
    label: r.variantLabel ? `Test ${r.variantLabel}: ${firstLine(r.hook ?? r.caption, 28)}` : firstLine(r.hook ?? r.caption),
    status: r.status,
    source: "scheduled",
    experimentId: r.experimentId,
  }));
  const since = now.getTime() - 8 * DAY_MS;
  const fromInstagram: PlanPostInput[] = reels
    .filter((p) => p.isReel && !scheduledMedia.has(p.id) && Date.parse(p.timestamp) >= since)
    .map((p) => ({
      id: p.id,
      at: new Date(p.timestamp),
      main: true,
      label: firstLine(p.hook),
      status: "PUBLISHED",
      source: "instagram",
    }));
  return [...fromQueue, ...fromInstagram];
}

export interface StrategyContext {
  now: Date;
  timeZone: string;
  hook: HookDataResult;
  reelPosts: HookPost[];
  reels: ReelStat[];
  rows: PostRow[];
  planPosts: PlanPostInput[];
  slots: BestSlots;
}

/** Shared inputs for planning (also used when creating tests and reposts). */
export async function loadStrategyContext(
  workspaceId: string,
  now = new Date()
): Promise<StrategyContext> {
  const timeZone = strategyTimeZone();
  const [hook, rows] = await Promise.all([
    getHookData(workspaceId),
    prisma.scheduledPost.findMany({
      where: {
        workspaceId,
        OR: [
          { status: { in: ["SCHEDULED", "PUBLISHING"] } },
          { scheduledAt: { gte: new Date(now.getTime() - 8 * DAY_MS) } },
          { publishedAt: { gte: new Date(now.getTime() - 8 * DAY_MS) } },
        ],
      },
      orderBy: { scheduledAt: "asc" },
      take: 300,
    }),
  ]);
  const reelPosts = hook.status === "ok" ? hook.data.posts.filter((p) => p.isReel) : [];
  const reels = reelPosts.map(toReelStat);
  const slots = bestSlots(
    reels.map((r) => ({ timestamp: r.timestamp, reach: r.reach, avgWatchTimeMs: r.avgWatchTimeMs })),
    timeZone
  );
  return {
    now,
    timeZone,
    hook,
    reelPosts,
    reels,
    rows,
    planPosts: postsToPlan(rows, reelPosts, now),
    slots,
  };
}

/* ------------------------------------------------------------------ */
/* Experiment views                                                    */
/* ------------------------------------------------------------------ */

const experimentInclude = {
  posts: { orderBy: { variantLabel: "asc" } },
} satisfies Prisma.StrategyExperimentInclude;

type ExperimentRow = Prisma.StrategyExperimentGetPayload<{ include: typeof experimentInclude }>;

export function toVariantView(p: PostRow): VariantView {
  return {
    id: p.id,
    label: p.variantLabel ?? "R",
    hook: p.hook,
    caption: p.caption,
    status: p.status,
    scheduledAt: p.scheduledAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    permalink: p.permalink,
    error: p.error,
    hasCover: Boolean(p.coverPath),
    durationSec: p.durationSec,
    metrics: (p.metrics as PostMetrics | null) ?? null,
    metricsAt: p.metricsAt?.toISOString() ?? null,
    graduatedAt: p.graduatedAt?.toISOString() ?? null,
    trial: p.trialStrategy !== null,
  };
}

export function toExperimentView(e: ExperimentRow): ExperimentView {
  const plan = (e.plan as ExperimentPlan | null) ?? null;
  return {
    id: e.id,
    kind: e.kind === "repost" ? "repost" : "ab_test",
    name: e.name,
    variable: e.variable as TestVariable,
    status: e.status as ExperimentStatus,
    error: e.error,
    createdAt: e.createdAt.toISOString(),
    decidedAt: e.decidedAt?.toISOString() ?? null,
    winnerPostId: e.winnerPostId,
    decision: (e.decision as StoredDecision | null) ?? null,
    progress: e.status === "draft" ? (plan?.progress ?? null) : null,
    startAt: plan?.startAt ?? e.posts[0]?.scheduledAt.toISOString() ?? null,
    sourceMediaId: e.sourceMediaId,
    variants: e.posts.map(toVariantView),
  };
}

/** Mark drafts whose render died (server restart) as cancelled. */
export async function expireStaleDrafts(now = new Date()): Promise<number> {
  const res = await prisma.strategyExperiment.updateMany({
    where: { status: "draft", updatedAt: { lt: new Date(now.getTime() - STALE_DRAFT_MS) } },
    data: { status: "cancelled", error: "Rendering was interrupted. Start the test again." },
  });
  return res.count;
}

export async function listExperiments(workspaceId: string, now = new Date()): Promise<ExperimentView[]> {
  await expireStaleDrafts(now);
  const rows = await prisma.strategyExperiment.findMany({
    where: {
      workspaceId,
      OR: [
        { status: { in: ["draft", "scheduled", "running", "deciding"] } },
        { updatedAt: { gte: new Date(now.getTime() - 45 * DAY_MS) }, status: { not: "cancelled" } },
        { updatedAt: { gte: new Date(now.getTime() - 2 * DAY_MS) }, status: "cancelled" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: experimentInclude,
  });
  return rows.map(toExperimentView);
}

export async function getExperimentView(workspaceId: string, id: string): Promise<ExperimentView | null> {
  const row = await prisma.strategyExperiment.findFirst({
    where: { id, workspaceId },
    include: experimentInclude,
  });
  return row ? toExperimentView(row) : null;
}

/** Start times of hook-test batches (for the 2-per-week limit). */
export function batchStarts(experiments: ExperimentView[]): Date[] {
  return experiments
    .filter((e) => e.kind === "ab_test" && e.status !== "cancelled" && e.startAt)
    .map((e) => new Date(e.startAt as string));
}

/* ------------------------------------------------------------------ */
/* Everything for the page                                             */
/* ------------------------------------------------------------------ */

export async function getStrategyData(workspaceId: string): Promise<StrategyData> {
  const ctx = await loadStrategyContext(workspaceId);
  const { now, timeZone, slots } = ctx;
  const [experiments, tags, repostRows, older] = await Promise.all([
    listExperiments(workspaceId, now),
    loadTags(workspaceId),
    prisma.scheduledPost.findMany({
      where: {
        workspaceId,
        sourceMediaId: { not: null },
        createdAt: { gte: new Date(now.getTime() - 60 * DAY_MS) },
      },
      select: { sourceMediaId: true, kind: true, createdAt: true },
    }),
    ctx.hook.status === "ok" ? getOlderReels(workspaceId) : Promise.resolve([]),
  ]);
  const recentIds = new Set(ctx.reels.map((r) => r.id));
  const library = [...ctx.reels, ...older.filter((p) => !recentIds.has(p.id)).map(toReelStat)];

  const recentReposts = new Set(
    repostRows
      .filter((r) => r.kind === "repost" && r.createdAt.getTime() >= now.getTime() - REPOST_DEFAULT_GAP_DAYS * DAY_MS)
      .map((r) => r.sourceMediaId as string)
  );
  const usedSources = new Set([
    ...repostRows.map((r) => r.sourceMediaId as string),
    ...experiments.map((e) => e.sourceMediaId).filter((x): x is string => !!x),
  ]);
  const candidates = repostCandidates(library, { now, recentRepostSources: recentReposts });
  const plan = planWeek({ now, timeZone, posts: ctx.planPosts, slots });
  const moves = buildMoves({
    now,
    timeZone,
    reels: ctx.reels,
    tags,
    candidates,
    experiments,
    plan,
    usedSources,
  });

  tagReelsInBackground(workspaceId, ctx.reels, new Set(tags.keys()));

  const candidateById = new Map(candidates.map((c) => [c.reel.id, c]));
  const reels: ReelOption[] = library.map((r) => {
    const c = candidateById.get(r.id);
    return {
      id: r.id,
      hook: r.hook,
      timestamp: r.timestamp,
      thumbnailUrl: r.thumbnailUrl,
      permalink: r.permalink,
      reach: r.reach,
      hold3s: r.hold3s,
      sharesPerReach: r.shares !== null && r.reach ? r.shares / r.reach : null,
      avgWatchSec: r.avgWatchTimeMs === null ? null : r.avgWatchTimeMs / 1000,
      repostable: Boolean(c),
      repostAt: c ? c.earliestAt.toISOString() : null,
      repostReason: c?.reason ?? null,
    };
  });

  const starts = batchStarts(experiments);
  const nextTest = findSlot({
    now,
    timeZone,
    slots,
    posts: ctx.planPosts,
    main: false,
    spanMinutes: (MAX_VARIANTS - 1) * VARIANT_STAGGER_MIN,
  });
  const nextMain = findSlot({ now, timeZone, slots, posts: ctx.planPosts, main: true });

  return {
    timeZone,
    generatedAt: now.toISOString(),
    insights: ctx.hook.status,
    insightsMessage: ctx.hook.status === "error" ? ctx.hook.message : null,
    plan: { ...plan, slotsNote: slots.note, slotsSource: slots.source },
    moves,
    experiments,
    reels,
    nextTestSlot: nextTest.toISOString(),
    nextMainSlot: nextMain.toISOString(),
    testBatchesThisWeek: starts.filter(
      (s) => Math.abs(s.getTime() - now.getTime()) < 7 * DAY_MS
    ).length,
    limits: {
      maxVariants: MAX_VARIANTS,
      maxBatchesPerWeek: MAX_TEST_BATCHES_PER_WEEK,
      staggerMin: VARIANT_STAGGER_MIN,
    },
  };
}
