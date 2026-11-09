/**
 * Expected retention, grounded in the creator's own numbers.
 *
 * We describe his distribution (median / IQR / min / max of 3-second hold and
 * average watch) to the model, ask it to place a new story inside that
 * distribution with a short justification, then clamp what comes back to sane
 * ranges and to his observed min/max plus a margin. If the model says nothing
 * usable we fall back to his IQR.
 */

import { prisma } from "@/lib/db/client";
import type { HookPost } from "@/lib/server/hook-coach";
import type { ExpectedRetention, Range } from "@/lib/coach/types";

export interface Dist {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface RetentionStats {
  hold3s: Dist | null;
  /** Average watch time in seconds. */
  avgWatchSec: Dist | null;
  /** Average watch as a share of reel length (only reels whose length we know). */
  avgWatchPct: Dist | null;
}

const HOLD_MARGIN = 0.12;
const WATCH_MARGIN = 0.15;
const MAX_WIDTH = 0.3;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function dist(values: Array<number | null | undefined>): Dist | null {
  const sorted = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    n: sorted.length,
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

/** Reel lengths we learned from earlier analyses (Graph API doesn't report duration). */
export async function knownDurations(
  workspaceId: string
): Promise<Map<string, number>> {
  const rows = await prisma.coachAnalysis.findMany({
    where: { workspaceId, kind: "analyze", mediaId: { not: null } },
    select: { mediaId: true, result: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const d = (r.result as { durationSec?: unknown } | null)?.durationSec;
    if (r.mediaId && typeof d === "number" && d > 0 && !map.has(r.mediaId)) {
      map.set(r.mediaId, d);
    }
  }
  return map;
}

export function watchPct(
  post: Pick<HookPost, "id" | "avgWatchTimeMs">,
  durations: Map<string, number>
): number | null {
  const d = durations.get(post.id);
  if (!d || post.avgWatchTimeMs === null) return null;
  return post.avgWatchTimeMs / 1000 / d;
}

export function retentionStats(
  posts: HookPost[],
  durations: Map<string, number>
): RetentionStats {
  const reels = posts.filter((p) => p.isReel);
  return {
    hold3s: dist(reels.map((p) => p.hold3s)),
    avgWatchSec: dist(
      reels.map((p) => (p.avgWatchTimeMs === null ? null : p.avgWatchTimeMs / 1000))
    ),
    avgWatchPct: dist(reels.map((p) => watchPct(p, durations))),
  };
}

const p = (v: number) => `${Math.round(v * 100)}%`;
const s = (v: number) => `${v.toFixed(1)}s`;

function describeDist(d: Dist, fmt: (v: number) => string) {
  return `median ${fmt(d.median)}, middle half ${fmt(d.q1)}–${fmt(d.q3)}, worst ${fmt(d.min)}, best ${fmt(d.max)} (n=${d.n})`;
}

/** His distribution as prompt text. */
export function statsText(stats: RetentionStats): string {
  const lines = ["HIS RETENTION DISTRIBUTION (last 30 posts, reels only):"];
  lines.push(
    stats.hold3s
      ? `- 3-second hold: ${describeDist(stats.hold3s, p)}`
      : "- 3-second hold: not reported by Instagram"
  );
  lines.push(
    stats.avgWatchSec
      ? `- Avg watch time: ${describeDist(stats.avgWatchSec, s)}`
      : "- Avg watch time: not reported by Instagram"
  );
  if (stats.avgWatchPct) {
    lines.push(
      `- Avg watch as % of reel length: ${describeDist(stats.avgWatchPct, p)}`
    );
  }
  return lines.join("\n");
}

export const RETENTION_SHAPE = `{"hold3s": {"low": 0-1, "mid": 0-1, "high": 0-1}, "avgWatchPct": {"low": 0-1, "mid": 0-1, "high": 0-1}, "justification": "one sentence: where this sits in HIS distribution and why"}`;

export const RETENTION_RULES = `EXPECTED RETENTION: place this story inside HIS distribution above, never outside reason. A strong hook moves 3-second hold toward his best, not past it by much. avgWatchPct = expected average watch time / the story's total length (0-1). Ranges are low/likely/high; keep them honest and fairly tight (5-15 points wide).`;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace("%", "")) : Number(v);
  if (!Number.isFinite(n)) return null;
  // Accept 52 as 52%.
  return n > 1.5 ? n / 100 : n;
}

function cleanRange(
  raw: unknown,
  bounds: [number, number],
  fallback: Range | null
): Range | null {
  let low: number | null = null;
  let mid: number | null = null;
  let high: number | null = null;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    low = num(r.low);
    mid = num(r.mid ?? r.likely ?? r.expected);
    high = num(r.high);
  }
  if (low === null && mid === null && high === null) {
    if (!fallback) return null;
    ({ low, mid, high } = fallback);
  }
  mid ??= low !== null && high !== null ? (low + high) / 2 : (low ?? high)!;
  low ??= mid - 0.04;
  high ??= mid + 0.04;
  const [lo, hi] = bounds;
  const vals = [low, mid, high].map((v) => clamp(v, lo, hi)).sort((a, b) => a - b);
  const m = vals[1];
  let [l, , h] = vals;
  if (h - l > MAX_WIDTH) {
    l = Math.max(l, m - MAX_WIDTH / 2);
    h = Math.min(h, m + MAX_WIDTH / 2);
  }
  if (h - l < 0.02) {
    l = clamp(m - 0.02, lo, hi);
    h = clamp(m + 0.02, lo, hi);
  }
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  return { low: r2(l), mid: r2(m), high: r2(h) };
}

function iqrRange(d: Dist | null): Range | null {
  return d ? { low: d.q1, mid: d.median, high: d.q3 } : null;
}

/**
 * Turn the model's retention guess into a clamped ExpectedRetention.
 * `storySeconds` lets us derive avg watch % from his watch-time seconds when
 * we don't know his reels' lengths.
 */
export function cleanRetention(
  raw: unknown,
  stats: RetentionStats,
  opts: {
    storySeconds?: number | null;
    actual?: ExpectedRetention["actual"];
  } = {}
): ExpectedRetention | undefined {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const holdBounds: [number, number] = stats.hold3s
    ? [
        Math.max(0.05, stats.hold3s.min - HOLD_MARGIN),
        Math.min(0.97, stats.hold3s.max + HOLD_MARGIN),
      ]
    : [0.05, 0.95];

  let watchFallback = iqrRange(stats.avgWatchPct);
  if (!watchFallback && stats.avgWatchSec && opts.storySeconds) {
    const d = opts.storySeconds;
    watchFallback = {
      low: stats.avgWatchSec.q1 / d,
      mid: stats.avgWatchSec.median / d,
      high: stats.avgWatchSec.q3 / d,
    };
  }
  let watchBounds: [number, number] = [0.03, 1];
  if (stats.avgWatchPct) {
    watchBounds = [
      Math.max(0.03, stats.avgWatchPct.min - WATCH_MARGIN),
      Math.min(1, stats.avgWatchPct.max + WATCH_MARGIN),
    ];
  } else if (stats.avgWatchSec && opts.storySeconds) {
    watchBounds = [
      Math.max(0.03, stats.avgWatchSec.min / opts.storySeconds - WATCH_MARGIN),
      Math.min(1, stats.avgWatchSec.max / opts.storySeconds + WATCH_MARGIN),
    ];
    if (watchBounds[0] >= watchBounds[1]) watchBounds = [0.03, 1];
  }

  const hold3s = stats.hold3s
    ? cleanRange(r.hold3s, holdBounds, iqrRange(stats.hold3s))
    : cleanRange(r.hold3s, holdBounds, null);
  const avgWatchPct = cleanRange(
    r.avgWatchPct ?? r.avgWatch,
    watchBounds,
    watchFallback
  );
  if (!hold3s && !avgWatchPct) return undefined;

  const why =
    typeof r.justification === "string"
      ? r.justification.trim()
      : typeof r.basis === "string"
        ? r.basis.trim()
        : "";
  const grounding = stats.hold3s
    ? `Your 3s hold: median ${p(stats.hold3s.median)}, middle half ${p(stats.hold3s.q1)}–${p(stats.hold3s.q3)} over ${stats.hold3s.n} reels.`
    : "Instagram hasn't reported your 3s hold yet, so this is a rough guess.";

  return {
    hold3s,
    avgWatchPct,
    basis: [why, grounding].filter(Boolean).join(" "),
    ...(opts.actual ? { actual: opts.actual } : {}),
  };
}
