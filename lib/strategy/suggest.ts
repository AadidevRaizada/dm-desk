/**
 * "Suggested moves": ranked, one-tap next steps built from his real numbers
 * (research notes R1, R4, R5, R7, R8). Pure module; the server gathers the
 * inputs in lib/strategy/data.ts.
 */

import {
  DAY_MS,
  DOUBLE_DOWN_RATIO,
  DOUBLE_DOWN_WINDOW_DAYS,
  FOLLOW_UP_MAX_DAYS,
  FOLLOW_UP_MIN_DAYS,
} from "@/lib/strategy/config";
import type { WeekPlan } from "@/lib/strategy/cadence";
import { describeSlot } from "@/lib/strategy/cadence";
import type { ReelStat, RepostCandidate } from "@/lib/strategy/candidates";
import { percentile } from "@/lib/strategy/score";
import type { ExperimentView, Move } from "@/lib/strategy/types";

export interface MoveInputs {
  now: Date;
  timeZone: string;
  reels: ReelStat[];
  tags: Map<string, { format: string; topic: string }>;
  candidates: RepostCandidate[];
  experiments: ExperimentView[];
  plan: WeekPlan;
  /** Media ids that already have a test or repost (skip them). */
  usedSources: Set<string>;
  maxMoves?: number;
}

const quote = (s: string, n = 48) => {
  const t = s.trim() || "untitled reel";
  return `“${t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t}”`;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const spr = (r: ReelStat) => (r.shares === null || !r.reach ? null : r.shares / r.reach);

export function pushWinnerMoves(experiments: ExperimentView[]): Move[] {
  const out: Move[] = [];
  for (const e of experiments) {
    if (e.status !== "decided" || !e.winnerPostId) continue;
    const winner = e.variants.find((v) => v.id === e.winnerPostId);
    if (!winner || !winner.trial || winner.graduatedAt || e.decision?.repostedPostId) continue;
    out.push({
      id: `push:${e.id}`,
      kind: "push_winner",
      title: `Push the winner: ${quote(winner.hook ?? winner.label)}`,
      reason: `${e.decision?.reason ?? "This variant won."} Open it in Instagram and tap “Share to everyone”.`,
      cta: "Open in Instagram",
      priority: 100,
      action: { type: "push_winner", experimentId: e.id, permalink: winner.permalink },
    });
  }
  return out;
}

export function fillWeekMove(plan: WeekPlan, timeZone: string): Move | null {
  if (plan.openSlots.length === 0) return null;
  const gapDays = plan.days.filter((d) => !d.hasMain && d.bestSlot).map((d) => d.label);
  const left = plan.target - plan.mainCount;
  const slots = plan.openSlots.map((s) => describeSlot(new Date(s), timeZone)).join(", ");
  return {
    id: "fill-week",
    kind: "fill_week",
    title: `Fill your week: ${left} main reel${left === 1 ? "" : "s"} to go`,
    reason: `No main reel planned ${gapDays.length > 3 ? `on ${gapDays.length} of the next 7 days` : `on ${gapDays.join(", ")}`}. Your best slots: ${slots}.`,
    cta: "Plan one",
    priority: 70,
    action: { type: "plan_post", at: plan.openSlots[0], captionSeed: null },
  };
}

export function part2Moves(i: MoveInputs): Move[] {
  const since = i.now.getTime() - DOUBLE_DOWN_WINDOW_DAYS * DAY_MS;
  const recent = i.reels.filter((r) => Date.parse(r.timestamp) >= since && spr(r) !== null);
  const accountMedian = median(recent.map((r) => spr(r) as number));
  if (!accountMedian || recent.length < 3) return [];

  const byFormat = new Map<string, ReelStat[]>();
  for (const r of recent) {
    const tag = i.tags.get(r.id);
    if (!tag || tag.format === "other") continue;
    byFormat.set(tag.format, [...(byFormat.get(tag.format) ?? []), r]);
  }
  const out: Move[] = [];
  for (const [format, items] of byFormat) {
    if (items.length < 2) continue;
    const m = median(items.map((r) => spr(r) as number)) ?? 0;
    const ratio = m / accountMedian;
    if (ratio < DOUBLE_DOWN_RATIO) continue;
    const best = [...items].sort((a, b) => (spr(b) ?? 0) - (spr(a) ?? 0))[0];
    const posted = Date.parse(best.timestamp);
    const from = Math.max(i.now.getTime(), posted + FOLLOW_UP_MIN_DAYS * DAY_MS);
    const until = Math.max(from + DAY_MS, posted + FOLLOW_UP_MAX_DAYS * DAY_MS);
    const slot =
      i.plan.days.map((d) => d.bestSlot).find((s) => s && Date.parse(s) >= from && Date.parse(s) <= until) ??
      i.plan.openSlots[0] ??
      new Date(from + DAY_MS).toISOString();
    const topic = i.tags.get(best.id)?.topic;
    out.push({
      id: `part2:${format}`,
      kind: "part2",
      title: `Part 2: another ${format} reel`,
      reason: `Your ${format} reels get ${ratio.toFixed(1)}× your median shares/reach over the last ${DOUBLE_DOWN_WINDOW_DAYS} days (best: ${quote(best.hook)}${topic ? `, about ${topic}` : ""}). Post a follow-up ${FOLLOW_UP_MIN_DAYS}–${FOLLOW_UP_MAX_DAYS} days after it.`,
      cta: "Plan Part 2",
      priority: 60 + Math.min(9, Math.round(ratio)),
      action: {
        type: "plan_post",
        at: slot,
        captionSeed: `Part 2: ${topic ?? best.hook}`.slice(0, 120),
      },
    });
  }
  return out;
}

export function remixMoves(i: MoveInputs, limit = 2): Move[] {
  return i.candidates
    .filter((c) => !i.usedSources.has(c.reel.id))
    .slice(0, limit)
    .map((c, idx) => ({
      id: `remix:${c.reel.id}`,
      kind: "remix" as const,
      title: `Remix & repost ${quote(c.reel.hook)}`,
      reason: `${c.reason}, posted ${Math.round(c.ageDays)} days ago. A new hook, cover and tighter open give it a fresh run as a trial reel.`,
      cta: "Remix it",
      priority: 50 - idx,
      action: { type: "remix" as const, mediaId: c.reel.id },
    }));
}

/**
 * Hook problems: reels where people who stayed watched well (avg watch in
 * his top half) but too many skipped in the first 3 s (hold in his bottom
 * third). The hook is the cheapest thing to fix.
 */
export function hookTestMoves(i: MoveInputs, limit = 1): Move[] {
  const watchPool = i.reels.map((r) => r.avgWatchTimeMs).filter((x): x is number => x !== null);
  const holdPool = i.reels.map((r) => r.hold3s).filter((x): x is number => x !== null);
  if (watchPool.length < 4 || holdPool.length < 4) return [];
  const since = i.now.getTime() - 60 * DAY_MS;
  return i.reels
    .filter(
      (r) =>
        Date.parse(r.timestamp) >= since &&
        !i.usedSources.has(r.id) &&
        r.avgWatchTimeMs !== null &&
        r.hold3s !== null
    )
    .map((r) => ({
      r,
      watch: percentile(r.avgWatchTimeMs as number, watchPool),
      hold: percentile(r.hold3s as number, holdPool),
    }))
    .filter((x) => x.watch >= 0.5 && x.hold <= 0.35)
    .sort((a, b) => b.watch - b.hold - (a.watch - a.hold))
    .slice(0, limit)
    .map(({ r }) => ({
      id: `test:${r.id}`,
      kind: "test_hooks" as const,
      title: `Test hooks for ${quote(r.hook)}`,
      reason: `People who stayed watched ${((r.avgWatchTimeMs ?? 0) / 1000).toFixed(1)}s (your top half), but ${Math.round((1 - (r.hold3s ?? 0)) * 100)}% skipped in the first 3 s (your bottom third). That's a hook problem: test up to 5 new hooks as trial reels.`,
      cta: "Test hooks",
      priority: 40,
      action: { type: "test_hooks" as const, mediaId: r.id, idea: null },
    }));
}

export function buildMoves(i: MoveInputs): Move[] {
  const moves: Move[] = [
    ...pushWinnerMoves(i.experiments),
    ...i.plan.warnings.map((w, idx) => ({
      id: `warn:${idx}`,
      kind: "warning" as const,
      title: w.startsWith("Over cadence") ? "Over cadence" : "Too close together",
      reason: w,
      cta: "See queue",
      priority: 90,
      action: { type: "open_queue" as const },
    })),
  ];
  const fill = fillWeekMove(i.plan, i.timeZone);
  if (fill) moves.push(fill);
  moves.push(...part2Moves(i), ...remixMoves(i), ...hookTestMoves(i));
  const anyTest = i.experiments.some((e) => e.kind === "ab_test");
  if (!moves.some((m) => m.kind === "test_hooks") && !anyTest) {
    moves.push({
      id: "test:new",
      kind: "test_hooks",
      title: "Test 5 hooks on your next video",
      reason:
        "Trial reels only go to non-followers, so you can try several openings without spamming your followers. The engine picks the winner after 48–72 h.",
      cta: "Start a test",
      priority: 30,
      action: { type: "test_hooks", mediaId: null, idea: null },
    });
  }
  return moves.sort((a, b) => b.priority - a.priority).slice(0, i.maxMoves ?? 6);
}
