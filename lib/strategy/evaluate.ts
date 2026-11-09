/**
 * Experiment evaluator (research notes R2, R4). Every 15 minutes (worker
 * loop + /api/cron/evaluate-experiments):
 *   1. moves experiments along: scheduled → running once a variant is out;
 *   2. pulls insights for each published variant at 24 / 48 / 72 / 96 h and
 *      stores them on ScheduledPost.metrics (one snapshot per checkpoint);
 *   3. scores the batch (lib/strategy/score.ts) and decides from 48 h if the
 *      margin and minimum reach are met, otherwise at 72 h (winner or
 *      no_winner); the 96 h pull only refreshes the numbers because API
 *      insights can lag ~48 h;
 *   4. removes variant videos 14 days after a test ends and stale downloads.
 * Safe to run from several processes: each write is idempotent.
 */

import { existsSync } from "node:fs";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  getMediaInsights,
  RateLimitError,
  TokenExpiredError,
  type InstagramMediaInsights,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getHookData, normaliseSkipRate } from "@/lib/server/hook-coach";
import { absolutePath, removeFile } from "@/lib/scheduling/storage";
import {
  CHECKPOINT_HOURS,
  DAY_MS,
  EARLIEST_DECISION_HOURS,
  FINAL_DECISION_HOURS,
  HOUR_MS,
  MIN_TRIAL_REFERENCE,
  REPULL_HOURS,
  VARIANT_FILE_TTL_DAYS,
  type TestVariable,
} from "@/lib/strategy/config";
import { expireStaleDrafts } from "@/lib/strategy/data";
import {
  decide,
  ratiosOf,
  scoreVariants,
  type Decision,
  type RatioSet,
  type RawMetrics,
} from "@/lib/strategy/score";
import { cleanStaleSources } from "@/lib/strategy/sources";
import type { PostMetrics, StoredDecision } from "@/lib/strategy/types";

export const EVAL_METRICS = [
  "views",
  "reach",
  "likes",
  "saved",
  "shares",
  "ig_reels_avg_watch_time",
  "reels_skip_rate",
];
const BASIC_METRICS = ["views", "reach", "likes", "saved", "shares"];

export interface EvaluateSummary {
  experiments: number;
  pulled: number;
  decided: number;
  noWinner: number;
  errors: number;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** The newest checkpoint that is due and hasn't been pulled yet. */
export function dueCheckpoint(publishedAt: Date, now: Date, done: string[]): number | null {
  const age = (now.getTime() - publishedAt.getTime()) / HOUR_MS;
  const due = [...CHECKPOINT_HOURS].reverse().find((h) => age >= h);
  if (due === undefined || done.includes(String(due))) return null;
  return due;
}

export function toPostMetrics(
  ins: InstagramMediaInsights,
  previous: PostMetrics | null,
  checkpoint: number,
  at: Date
): PostMetrics {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const latest = {
    reach: n(ins.reach),
    views: n(ins.views),
    likes: n(ins.likes),
    saved: n(ins.saved),
    shares: n(ins.shares),
    avgWatchMs: n(ins.ig_reels_avg_watch_time),
    skipRate: normaliseSkipRate(ins.reels_skip_rate),
  };
  return {
    ...latest,
    checkpoints: {
      ...(previous?.checkpoints ?? {}),
      [String(checkpoint)]: { ...latest, at: at.toISOString() },
    },
  };
}

export function rawFrom(m: PostMetrics | null, durationSec: number | null): RawMetrics | null {
  if (!m) return null;
  return {
    reach: m.reach,
    views: m.views,
    likes: m.likes,
    saved: m.saved,
    shares: m.shares,
    avgWatchMs: m.avgWatchMs,
    skipRate: m.skipRate,
    durationSec,
  };
}

async function pullInsights(token: string, mediaId: string): Promise<InstagramMediaInsights> {
  try {
    return await getMediaInsights(token, mediaId, EVAL_METRICS);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof RateLimitError) throw err;
    // Reel-only metrics can be refused (e.g. very new media); fall back.
    return getMediaInsights(token, mediaId, BASIC_METRICS);
  }
}

/** Reference pool: his trial history when there's enough, else his reels. */
async function referencePool(
  workspaceId: string,
  excludeExperimentId: string,
  kind: "ab_test" | "repost"
): Promise<{ pool: RatioSet[]; source: StoredDecision["reference"] }> {
  if (kind === "ab_test") {
    const trials = await prisma.scheduledPost.findMany({
      where: {
        workspaceId,
        kind: "trial_variant",
        metrics: { not: Prisma.DbNull },
        NOT: { experimentId: excludeExperimentId },
      },
      select: { metrics: true, durationSec: true },
      take: 200,
      orderBy: { publishedAt: "desc" },
    });
    const pool = trials
      .map((t) => rawFrom(t.metrics as PostMetrics | null, t.durationSec))
      .filter((r): r is RawMetrics => r !== null && (r.reach ?? 0) > 0)
      .map(ratiosOf);
    if (pool.length >= MIN_TRIAL_REFERENCE) return { pool, source: "trials" };
  }
  const hook = await getHookData(workspaceId);
  if (hook.status !== "ok") return { pool: [], source: "batch" };
  const pool = hook.data.posts
    .filter((p) => p.isReel && (p.reach ?? 0) > 0)
    .map((p) =>
      ratiosOf({
        reach: p.reach,
        likes: p.likes,
        saved: p.saved,
        shares: p.shares,
        avgWatchMs: p.avgWatchTimeMs,
        skipRate: p.skipRate,
        durationSec: null,
      })
    );
  return { pool, source: pool.length ? "reels" : "batch" };
}

type ExperimentWithPosts = Prisma.StrategyExperimentGetPayload<{
  include: { posts: true; instagramAccount: { select: { accessToken: true } } };
}>;

export async function evaluateExperiments(
  opts: { now?: Date } = {}
): Promise<EvaluateSummary> {
  const now = opts.now ?? new Date();
  const summary: EvaluateSummary = { experiments: 0, pulled: 0, decided: 0, noWinner: 0, errors: 0 };

  await expireStaleDrafts(now);
  const active = await prisma.strategyExperiment.findMany({
    where: {
      OR: [
        { status: { in: ["scheduled", "running", "deciding"] } },
        // Keep pulling until the 96 h re-pull is in.
        {
          status: { in: ["decided", "no_winner"] },
          decidedAt: { gte: new Date(now.getTime() - (REPULL_HOURS + 48) * HOUR_MS) },
        },
      ],
    },
    include: { posts: true, instagramAccount: { select: { accessToken: true } } },
    take: 50,
  });

  for (const exp of active) {
    summary.experiments += 1;
    try {
      const outcome = await evaluateOne(exp, now, summary);
      if (outcome === "winner") summary.decided += 1;
      if (outcome === "no_winner") summary.noWinner += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(
        `[Strategy] Evaluate ${exp.id} failed:`,
        err instanceof Error ? err.message : err
      );
      if (err instanceof RateLimitError) break;
    }
  }

  await cleanupFiles(now).catch(() => undefined);
  return summary;
}

async function evaluateOne(
  exp: ExperimentWithPosts,
  now: Date,
  summary: EvaluateSummary
): Promise<Decision["outcome"] | null> {
  const posts = exp.posts;
  if (posts.length === 0) return null;

  if (posts.every((p) => p.status === "FAILED")) {
    await prisma.strategyExperiment.update({
      where: { id: exp.id },
      data: { status: "cancelled", error: "Every variant failed to publish. See the queue for why." },
    });
    return null;
  }

  // 1) Pull due checkpoints.
  let token: string | null = null;
  let changed = false;
  for (const p of posts) {
    if (p.status !== "PUBLISHED" || !p.mediaId || !p.publishedAt) continue;
    const prev = (p.metrics as PostMetrics | null) ?? null;
    const due = dueCheckpoint(p.publishedAt, now, Object.keys(prev?.checkpoints ?? {}));
    if (due === null) continue;
    token ??= decryptToken(exp.instagramAccount.accessToken);
    const ins = await pullInsights(token, p.mediaId);
    const metrics = toPostMetrics(ins, prev, due, now);
    await prisma.scheduledPost.update({
      where: { id: p.id },
      data: { metrics: json(metrics), metricsAt: now },
    });
    p.metrics = json(metrics) as Prisma.JsonValue;
    p.metricsAt = now;
    summary.pulled += 1;
    changed = true;
  }

  const published = posts.filter((p) => p.status === "PUBLISHED" && p.publishedAt);
  const terminal = exp.status === "decided" || exp.status === "no_winner";
  if (published.length === 0) return null;
  if (exp.status === "scheduled") {
    await prisma.strategyExperiment.update({ where: { id: exp.id }, data: { status: "running" } });
  }
  if (!changed && terminal) return null;

  // 2) Score (always, so the UI shows live bars) and decide.
  const live = posts.filter((p) => p.status !== "FAILED");
  const allPublished = live.length > 0 && live.every((p) => p.status === "PUBLISHED");
  const ageHours = Math.min(
    ...published.map((p) => (now.getTime() - (p.publishedAt as Date).getTime()) / HOUR_MS)
  );
  const kind = exp.kind === "repost" ? "repost" : "ab_test";
  const { pool, source } = await referencePool(exp.workspaceId, exp.id, kind);

  let decision: Decision;
  let scores: StoredDecision["scores"];
  let components: string[];
  let originalScore: number | null = null;

  if (kind === "ab_test") {
    const result = scoreVariants(
      live.map((p) => ({
        id: p.id,
        label: p.variantLabel ?? "?",
        metrics: rawFrom((p.metrics as PostMetrics | null) ?? null, p.durationSec),
      })),
      pool
    );
    components = result.components;
    scores = result.scored.map((s) => ({
      postId: s.id,
      label: s.label,
      score: s.score,
      reach: s.reach,
      eligible: s.eligible,
      ratios: s.ratios,
      pct: s.pct,
    }));
    decision = decide(result.scored, result.components, {
      ageHours,
      variable: exp.variable as TestVariable,
      allPublished,
    });
  } else {
    const r = await judgeRepost(exp, live[0], pool, ageHours);
    decision = r.decision;
    scores = r.scores;
    components = r.components;
    originalScore = r.originalScore;
  }

  const previous = (exp.decision as StoredDecision | null) ?? null;
  const stored: StoredDecision = {
    ...(previous ?? {}),
    ...decision,
    components,
    scores,
    reference: source,
    ageHours,
    evaluatedAt: now.toISOString(),
    originalScore,
  };

  if (terminal) {
    // Re-pull after the decision: refresh numbers, keep the call.
    await prisma.strategyExperiment.update({
      where: { id: exp.id },
      data: {
        decision: json({
          ...previous,
          scores,
          components,
          evaluatedAt: now.toISOString(),
          repulledAt: ageHours >= REPULL_HOURS ? now.toISOString() : previous?.repulledAt ?? null,
        }),
      },
    });
    return null;
  }

  if (decision.outcome === "wait") {
    await prisma.strategyExperiment.update({
      where: { id: exp.id },
      data: {
        status: ageHours >= EARLIEST_DECISION_HOURS ? "deciding" : "running",
        decision: json(stored),
      },
    });
    return "wait";
  }

  await prisma.strategyExperiment.update({
    where: { id: exp.id },
    data: {
      status: decision.outcome === "winner" ? "decided" : "no_winner",
      winnerPostId: decision.winnerId,
      decidedAt: now,
      decision: json(stored),
    },
  });
  console.log(`[Strategy] ${exp.id}: ${decision.reason}`);
  return decision.outcome;
}

/**
 * A repost "wins" when it scores at least as well as the original reel in
 * the same pool (or, if the original is too old to have numbers, beats his
 * median). Judged at the final checkpoint only.
 */
async function judgeRepost(
  exp: ExperimentWithPosts,
  post: ExperimentWithPosts["posts"][number] | undefined,
  pool: RatioSet[],
  ageHours: number
) {
  const metrics = rawFrom((post?.metrics as PostMetrics | null) ?? null, post?.durationSec ?? null);
  const hook = await getHookData(exp.workspaceId);
  const original =
    hook.status === "ok" && exp.sourceMediaId
      ? hook.data.posts.find((p) => p.id === exp.sourceMediaId)
      : undefined;
  const variants = [
    { id: post?.id ?? "repost", label: "Remix", metrics: metrics ? { ...metrics, durationSec: null } : null },
    ...(original
      ? [
          {
            id: "original",
            label: "Original",
            metrics: {
              reach: original.reach,
              likes: original.likes,
              saved: original.saved,
              shares: original.shares,
              avgWatchMs: original.avgWatchTimeMs,
              skipRate: original.skipRate,
              durationSec: null,
            },
          },
        ]
      : []),
  ];
  const result = scoreVariants(variants, pool);
  const remix = result.scored[0];
  const orig = result.scored[1] ?? null;
  const scores = result.scored
    .filter((s) => s.id !== "original")
    .map((s) => ({ postId: s.id, label: s.label, score: s.score, reach: s.reach, eligible: s.eligible, ratios: s.ratios, pct: s.pct }));
  const base = { winnerId: null, margin: null, coreWins: null, coreNeeded: null, nextVariable: null, nextReason: null };
  const pctText = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

  let decision: Decision;
  if (!post || post.status !== "PUBLISHED" || ageHours < FINAL_DECISION_HOURS) {
    decision = { ...base, outcome: "wait", reason: `Judged at ${FINAL_DECISION_HOURS} h against the original.` };
  } else {
    const target = orig?.score ?? 0.5;
    const ok = remix.score !== null && remix.score >= target;
    decision = ok
      ? {
          ...base,
          outcome: "winner",
          winnerId: post.id,
          reason: `The remix scored ${pctText(remix.score)} vs ${orig ? `the original's ${pctText(orig.score)}` : "your median 50%"}.${post.trialStrategy ? " Share it to your followers." : ""}`,
        }
      : {
          ...base,
          outcome: "no_winner",
          reason: `The remix scored ${pctText(remix.score)} vs ${orig ? `the original's ${pctText(orig.score)}` : "your median 50%"}. Keep it as a trial.`,
          nextVariable: "hook",
          nextReason: "Try a remix with a bolder hook, or test 5 hooks on it first.",
        };
  }
  return { decision, scores, components: result.components as string[], originalScore: orig?.score ?? null };
}

/** Variant videos are kept for "repost winner"; drop them after the TTL. */
async function cleanupFiles(now: Date) {
  const cutoff = new Date(now.getTime() - VARIANT_FILE_TTL_DAYS * DAY_MS);
  const old = await prisma.scheduledPost.findMany({
    where: {
      kind: "trial_variant",
      status: "PUBLISHED",
      publishedAt: { lt: cutoff },
    },
    select: { videoPath: true },
    take: 200,
  });
  for (const p of old) {
    if (existsSync(absolutePath(p.videoPath))) await removeFile(p.videoPath);
  }
  await cleanStaleSources(now.getTime());
}
