/**
 * Creating and acting on experiments:
 *   - "Test up to 5 hooks": one trial reel per hook (MANUAL graduation so no
 *     variant auto-shares), staggered VARIANT_STAGGER_MIN apart.
 *   - "Remix & repost": one re-edit of an old reel (new hook, tighter open,
 *     new cover, new caption), a trial by default, ≥30 days after the original.
 *   - "Done, I shared it", "Repost winner to followers", cancel.
 *
 * Rendering runs in the background inside the Next server process (like the
 * Coach analyzer): the experiment sits in "draft" with progress in its plan
 * until the variant posts exist, then becomes "scheduled". Server only.
 */

import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  absolutePath,
  coverRelPath,
  extractCover,
  faststartRemux,
  removeFile,
  removeUpload,
  SCHEDULED_DIR,
} from "@/lib/scheduling/storage";
import { captionProblem } from "@/lib/scheduling/rules";
import { findSlot, overTestLimit } from "@/lib/strategy/cadence";
import { minRepostAt } from "@/lib/strategy/candidates";
import {
  API_POSTS_PER_24H,
  DAY_MS,
  HOOK_POSITION_DEFAULT,
  MAX_TEST_BATCHES_PER_WEEK,
  MAX_VARIANTS,
  MIN_VARIANTS,
  REPOST_DEFAULT_GAP_DAYS,
  REPOST_MIN_GAP_DAYS,
  TEST_TRIAL_STRATEGY,
  VARIABLE_LABEL,
  VARIANT_LABELS,
  VARIANT_STAGGER_MIN,
  type TestVariable,
} from "@/lib/strategy/config";
import { batchStarts, listExperiments, loadStrategyContext } from "@/lib/strategy/data";
import { resolveSource, SourceError, type SourceRef } from "@/lib/strategy/sources";
import type { ExperimentPlan, StoredDecision, VariantPlan } from "@/lib/strategy/types";
import { cleanHook, plannedDuration, renderVariantFile } from "@/lib/strategy/variants";

export class StrategyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "StrategyError";
  }
}

const newId = () => randomUUID().replace(/-/g, "");
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const MIN_RENDER_LEAD_MS = 5 * 60_000;

export interface VariantInput {
  hook: string | null;
  trimStartSec?: number;
  maxDurationSec?: number | null;
  coverOffsetMs?: number;
  caption?: string | null;
}

/* ------------------------------------------------------------------ */
/* Create: hook test                                                   */
/* ------------------------------------------------------------------ */

export async function createHookTest(args: {
  workspaceId: string;
  source: SourceRef;
  variable: TestVariable;
  name?: string | null;
  caption: string;
  shareToFeed?: boolean;
  scheduledAt?: string | null;
  hookPosition?: "top" | "middle";
  variants: VariantInput[];
}): Promise<{ id: string; startAt: string }> {
  const n = args.variants.length;
  if (n < MIN_VARIANTS || n > MAX_VARIANTS) {
    throw new StrategyError(`A test needs ${MIN_VARIANTS} to ${MAX_VARIANTS} variants.`);
  }
  for (const c of [args.caption, ...args.variants.map((v) => v.caption ?? "")]) {
    const problem = captionProblem(c);
    if (problem) throw new StrategyError(problem);
  }
  if (args.variable === "hook" && args.variants.some((v) => !cleanHook(v.hook))) {
    throw new StrategyError("Every variant needs a hook.");
  }

  const source = await resolveSource(args.workspaceId, args.source);
  for (const v of args.variants) {
    try {
      plannedDuration({ hook: v.hook, trimStartSec: v.trimStartSec, maxDurationSec: v.maxDurationSec }, source.durationSec);
    } catch (err) {
      throw new StrategyError(err instanceof Error ? err.message : String(err));
    }
  }

  const ctx = await loadStrategyContext(args.workspaceId);
  const span = (n - 1) * VARIANT_STAGGER_MIN;
  const start = args.scheduledAt
    ? new Date(args.scheduledAt)
    : findSlot({ now: ctx.now, timeZone: ctx.timeZone, slots: ctx.slots, posts: ctx.planPosts, main: false, spanMinutes: span });
  if (start.getTime() < Date.now() - 60_000) throw new StrategyError("Pick a time in the future.");

  const experiments = await listExperiments(args.workspaceId);
  if (overTestLimit(batchStarts(experiments), start)) {
    throw new StrategyError(
      `That week already has ${MAX_TEST_BATCHES_PER_WEEK} hook tests. Pick a later start, or let one finish first.`
    );
  }
  await assertPublishingRoom(source.instagramAccountId, start, n);

  const variants: VariantPlan[] = args.variants.map((v, i) => ({
    label: VARIANT_LABELS[i],
    hook: cleanHook(v.hook) || null,
    trimStartSec: Math.max(0, v.trimStartSec ?? 0),
    maxDurationSec: v.maxDurationSec ?? null,
    coverOffsetMs: Math.max(0, Math.round(v.coverOffsetMs ?? 0)),
    caption: v.caption?.trim() ? v.caption : null,
  }));
  const plan: ExperimentPlan = {
    startAt: start.toISOString(),
    hookPosition: args.hookPosition ?? HOOK_POSITION_DEFAULT,
    caption: args.caption,
    shareToFeed: args.shareToFeed ?? true,
    trial: true,
    source: args.source,
    sourceRelPath: source.relPath,
    variants,
    progress: { done: 0, total: n },
  };
  const name =
    args.name?.trim() ||
    `${VARIABLE_LABEL[args.variable]} test: ${source.reel?.hook || variants[0].hook || "new video"}`.slice(0, 120);

  const exp = await prisma.strategyExperiment.create({
    data: {
      workspaceId: args.workspaceId,
      instagramAccountId: source.instagramAccountId,
      kind: "ab_test",
      name,
      variable: args.variable,
      status: "draft",
      sourceMediaId: source.mediaId,
      plan: json(plan),
    },
    select: { id: true },
  });
  startRenderJob(exp.id);
  return { id: exp.id, startAt: plan.startAt };
}

/* ------------------------------------------------------------------ */
/* Create: remix & repost                                              */
/* ------------------------------------------------------------------ */

export async function createRepost(args: {
  workspaceId: string;
  mediaId: string;
  hook: string;
  caption: string;
  trimStartSec?: number;
  coverOffsetMs?: number;
  trial?: boolean;
  shareToFeed?: boolean;
  scheduledAt?: string | null;
  hookPosition?: "top" | "middle";
}): Promise<{ id: string; startAt: string }> {
  const problem = captionProblem(args.caption);
  if (problem) throw new StrategyError(problem);
  if (!cleanHook(args.hook)) throw new StrategyError("A repost needs a new hook.");
  if (!args.caption.trim()) throw new StrategyError("A repost needs a new caption.");

  const source = await resolveSource(args.workspaceId, { mediaId: args.mediaId });
  const reel = source.reel;
  if (!reel) throw new StrategyError("That reel isn't in your last 30 posts.", 404);
  if (reel.caption && reel.caption.trim() === args.caption.trim()) {
    throw new StrategyError("Change the caption: a repost needs a new one.");
  }
  if (reel.hook && cleanHook(reel.hook).toLowerCase() === cleanHook(args.hook).toLowerCase()) {
    throw new StrategyError("Use a different hook from the original.");
  }
  const trim = Math.max(0.3, args.trimStartSec ?? 0.6);
  try {
    plannedDuration({ hook: args.hook, trimStartSec: trim }, source.durationSec);
  } catch (err) {
    throw new StrategyError(err instanceof Error ? err.message : String(err));
  }

  const original = new Date(reel.timestamp);
  const ctx = await loadStrategyContext(args.workspaceId);
  const trial = args.trial ?? true;
  let start: Date;
  if (args.scheduledAt) {
    start = new Date(args.scheduledAt);
    if (start.getTime() < minRepostAt(original).getTime()) {
      throw new StrategyError(
        `Wait at least ${REPOST_MIN_GAP_DAYS} days after the original (from ${minRepostAt(original).toDateString()}).`
      );
    }
    if (start.getTime() < Date.now() - 60_000) throw new StrategyError("Pick a time in the future.");
  } else {
    start = findSlot({
      now: ctx.now,
      timeZone: ctx.timeZone,
      slots: ctx.slots,
      posts: ctx.planPosts,
      main: !trial,
      notBefore: new Date(original.getTime() + REPOST_DEFAULT_GAP_DAYS * DAY_MS),
    });
  }
  await assertPublishingRoom(source.instagramAccountId, start, 1);

  const plan: ExperimentPlan = {
    startAt: start.toISOString(),
    hookPosition: args.hookPosition ?? HOOK_POSITION_DEFAULT,
    caption: args.caption,
    shareToFeed: args.shareToFeed ?? true,
    trial,
    source: { mediaId: args.mediaId },
    sourceRelPath: source.relPath,
    variants: [
      {
        label: "R",
        hook: cleanHook(args.hook),
        trimStartSec: trim,
        maxDurationSec: null,
        coverOffsetMs: Math.max(0, Math.round(args.coverOffsetMs ?? 1500)),
        caption: null,
      },
    ],
    progress: { done: 0, total: 1 },
  };
  const exp = await prisma.strategyExperiment.create({
    data: {
      workspaceId: args.workspaceId,
      instagramAccountId: source.instagramAccountId,
      kind: "repost",
      name: `Remix: ${reel.hook || "reel"}`.slice(0, 120),
      variable: "hook",
      status: "draft",
      sourceMediaId: args.mediaId,
      plan: json(plan),
    },
    select: { id: true },
  });
  startRenderJob(exp.id);
  return { id: exp.id, startAt: plan.startAt };
}

/** Instagram allows 100 API posts per 24 h; leave room. */
async function assertPublishingRoom(instagramAccountId: string, at: Date, adding: number) {
  const around = await prisma.scheduledPost.count({
    where: {
      instagramAccountId,
      status: { not: "FAILED" },
      scheduledAt: { gte: new Date(at.getTime() - DAY_MS), lte: new Date(at.getTime() + DAY_MS) },
    },
  });
  if (around + adding > API_POSTS_PER_24H) {
    throw new StrategyError(`That would go over Instagram's ${API_POSTS_PER_24H} API posts a day.`);
  }
}

/* ------------------------------------------------------------------ */
/* Background render                                                   */
/* ------------------------------------------------------------------ */

const jobs: { queue: string[]; running: boolean } = { queue: [], running: false };

/** Queue a render; one at a time (ffmpeg uses every core). */
export function startRenderJob(experimentId: string) {
  if (jobs.queue.includes(experimentId)) return;
  jobs.queue.push(experimentId);
  void pump();
}

async function pump() {
  if (jobs.running) return;
  jobs.running = true;
  try {
    while (jobs.queue.length > 0) {
      const id = jobs.queue.shift()!;
      await renderExperiment(id).catch((err) =>
        console.error("[Strategy] render crashed:", err instanceof Error ? err.message : err)
      );
    }
  } finally {
    jobs.running = false;
  }
}

export async function renderExperiment(experimentId: string): Promise<void> {
  const exp = await prisma.strategyExperiment.findUnique({ where: { id: experimentId } });
  if (!exp || exp.status !== "draft") return;
  const plan = exp.plan as unknown as ExperimentPlan;
  const src = absolutePath(plan.sourceRelPath);
  const made: { id: string; videoPath: string; coverPath: string | null; durationSec: number; v: VariantPlan }[] = [];

  try {
    for (const [i, v] of plan.variants.entries()) {
      const id = newId();
      const videoPath = `${SCHEDULED_DIR}/${id}.mp4`;
      const { durationSec } = await renderVariantFile({
        src,
        out: absolutePath(videoPath),
        spec: {
          hook: v.hook,
          trimStartSec: v.trimStartSec,
          maxDurationSec: v.maxDurationSec,
          hookPosition: plan.hookPosition ?? HOOK_POSITION_DEFAULT,
        },
        tag: `dmdesk:${exp.kind}:${exp.id}:${v.label}`,
      });
      const offset = Math.min(v.coverOffsetMs, Math.max(0, Math.floor(durationSec * 1000) - 100));
      const coverRel = coverRelPath(id, offset);
      const hasCover = await extractCover(absolutePath(videoPath), offset, absolutePath(coverRel));
      made.push({ id, videoPath, coverPath: hasCover || offset > 0 ? coverRel : null, durationSec, v });
      plan.progress = { done: i + 1, total: plan.variants.length };
      await prisma.strategyExperiment.update({ where: { id: exp.id }, data: { plan: json(plan) } });
    }

    // Variants go out in the same window; if rendering ran past the
    // planned start, shift the whole batch to just after now.
    const start = Math.max(Date.parse(plan.startAt), Date.now() + MIN_RENDER_LEAD_MS);
    const kind = exp.kind === "repost" ? "repost" : "trial_variant";
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.strategyExperiment.findUnique({ where: { id: exp.id }, select: { status: true } });
      if (fresh?.status !== "draft") throw new Error("cancelled while rendering");
      for (const [i, m] of made.entries()) {
        await tx.scheduledPost.create({
          data: {
            id: m.id,
            workspaceId: exp.workspaceId,
            instagramAccountId: exp.instagramAccountId,
            caption: m.v.caption ?? plan.caption,
            videoPath: m.videoPath,
            coverPath: m.coverPath,
            shareToFeed: plan.shareToFeed,
            trialStrategy: plan.trial ? TEST_TRIAL_STRATEGY : null,
            scheduledAt: new Date(start + i * VARIANT_STAGGER_MIN * 60_000),
            status: "SCHEDULED",
            kind,
            experimentId: exp.id,
            variantLabel: m.v.label,
            hook: m.v.hook,
            sourceMediaId: exp.sourceMediaId,
            durationSec: m.durationSec,
          },
        });
      }
      await tx.strategyExperiment.update({
        where: { id: exp.id },
        data: { status: "scheduled", error: null, plan: json({ ...plan, startAt: new Date(start).toISOString() }) },
      });
    });
    if ("uploadId" in plan.source) await removeUpload(plan.source.uploadId);
    console.log(`[Strategy] Rendered ${made.length} variant(s) for ${exp.id}`);
  } catch (err) {
    for (const m of made) {
      await removeFile(m.videoPath);
      await removeFile(m.coverPath);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Strategy] Render failed for ${exp.id}: ${message}`);
    await prisma.strategyExperiment.updateMany({
      where: { id: exp.id, status: "draft" },
      data: {
        status: "cancelled",
        error: message.includes("cancelled") ? null : `Couldn't render the variants: ${message.slice(0, 300)}`,
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function ownedExperiment(workspaceId: string, id: string) {
  const exp = await prisma.strategyExperiment.findFirst({
    where: { id, workspaceId },
    include: { posts: true },
  });
  if (!exp) throw new StrategyError("Not found", 404);
  return exp;
}

/** "Done, I shared it": he tapped Share to everyone on the winning trial. */
export async function markShared(workspaceId: string, id: string): Promise<void> {
  const exp = await ownedExperiment(workspaceId, id);
  const winner = exp.posts.find((p) => p.id === exp.winnerPostId);
  if (!winner) throw new StrategyError("This test has no winner yet.", 409);
  const now = new Date();
  await prisma.$transaction([
    prisma.scheduledPost.update({ where: { id: winner.id }, data: { graduatedAt: now } }),
    prisma.strategyExperiment.update({
      where: { id },
      data: {
        decision: json({ ...((exp.decision as StoredDecision | null) ?? {}), sharedAt: now.toISOString() }),
      },
    }),
  ]);
}

/**
 * Alternative to sharing: schedule the winning variant as a normal reel to
 * followers. It is a duplicate of a trial, so the UI recommends sharing.
 */
export async function repostWinner(
  workspaceId: string,
  id: string,
  scheduledAt?: string | null
): Promise<{ postId: string; scheduledAt: string }> {
  const exp = await ownedExperiment(workspaceId, id);
  const winner = exp.posts.find((p) => p.id === exp.winnerPostId);
  if (!winner) throw new StrategyError("This test has no winner yet.", 409);
  const decision = (exp.decision as StoredDecision | null) ?? null;
  if (decision?.repostedPostId) throw new StrategyError("The winner is already scheduled for followers.", 409);

  const newIdValue = newId();
  const videoPath = `${SCHEDULED_DIR}/${newIdValue}.mp4`;
  const tmp = `${SCHEDULED_DIR}/${newIdValue}.src.mp4`;
  try {
    await copyFile(absolutePath(winner.videoPath), absolutePath(tmp));
  } catch {
    throw new StrategyError("The winner's video file is gone (kept for 14 days). Remix the reel instead.", 410);
  }
  const ok = await faststartRemux(absolutePath(tmp), absolutePath(videoPath));
  await rm(absolutePath(tmp), { force: true });
  if (!ok) throw new StrategyError("Couldn't prepare the video.", 500);

  const ctx = await loadStrategyContext(workspaceId);
  const at = scheduledAt
    ? new Date(scheduledAt)
    : findSlot({ now: ctx.now, timeZone: ctx.timeZone, slots: ctx.slots, posts: ctx.planPosts, main: true });
  if (at.getTime() < Date.now() - 60_000) throw new StrategyError("Pick a time in the future.");
  const offset = 1500;
  const coverRel = coverRelPath(newIdValue, offset);
  const hasCover = await extractCover(absolutePath(videoPath), offset, absolutePath(coverRel));

  await prisma.$transaction([
    prisma.scheduledPost.create({
      data: {
        id: newIdValue,
        workspaceId,
        instagramAccountId: exp.instagramAccountId,
        caption: winner.caption,
        videoPath,
        coverPath: hasCover ? coverRel : null,
        shareToFeed: true,
        trialStrategy: null,
        scheduledAt: at,
        status: "SCHEDULED",
        kind: "repost",
        hook: winner.hook,
        sourceMediaId: winner.mediaId,
        durationSec: winner.durationSec,
      },
    }),
    prisma.strategyExperiment.update({
      where: { id },
      data: { decision: json({ ...(decision ?? {}), repostedPostId: newIdValue }) },
    }),
  ]);
  return { postId: newIdValue, scheduledAt: at.toISOString() };
}

/** Cancel: unpublished variants are deleted; live ones stay on Instagram. */
export async function cancelExperiment(workspaceId: string, id: string): Promise<void> {
  const exp = await ownedExperiment(workspaceId, id);
  if (exp.status === "cancelled") return;
  const pending = exp.posts.filter((p) => p.status === "SCHEDULED" || p.status === "FAILED");
  if (exp.posts.some((p) => p.status === "PUBLISHING")) {
    throw new StrategyError("A variant is publishing right now. Try again in a minute.", 409);
  }
  await prisma.scheduledPost.deleteMany({
    where: { id: { in: pending.map((p) => p.id) }, status: { in: ["SCHEDULED", "FAILED"] } },
  });
  for (const p of pending) {
    await removeFile(p.videoPath);
    await removeFile(p.coverPath);
  }
  await prisma.strategyExperiment.update({
    where: { id },
    data: { status: "cancelled", error: null },
  });
}

export { SourceError };
