/**
 * Repost candidates (research note R1): his top reels by shares/reach or by
 * average watch time, at least REPOST_MIN_AGE_DAYS old, not already reposted
 * recently. Pure module.
 */

import {
  DAY_MS,
  REPOST_DEFAULT_GAP_DAYS,
  REPOST_MIN_AGE_DAYS,
  REPOST_MIN_CANDIDATES,
  REPOST_MIN_GAP_DAYS,
  REPOST_TOP_FRACTION,
} from "@/lib/strategy/config";

export interface ReelStat {
  id: string;
  timestamp: string;
  hook: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  reach: number | null;
  shares: number | null;
  saved: number | null;
  likes: number | null;
  avgWatchTimeMs: number | null;
  skipRate: number | null;
  hold3s: number | null;
}

export interface RepostCandidate {
  reel: ReelStat;
  sharesPerReach: number | null;
  avgWatchTimeMs: number | null;
  /** Why it qualified, e.g. "Top 20% by shares/reach (2.1%)". */
  reason: string;
  /** Earliest sensible repost time (original + default gap, never before now). */
  earliestAt: Date;
  ageDays: number;
}

function rankTop<T>(items: T[], value: (t: T) => number | null, k: number): Set<T> {
  return new Set(
    items
      .filter((t) => value(t) !== null)
      .sort((a, b) => (value(b) as number) - (value(a) as number))
      .slice(0, k)
  );
}

/**
 * @param recentRepostSources media ids reposted (or scheduled to be) within
 *   the default gap; they are skipped so the same reel isn't reposted twice.
 */
export function repostCandidates(
  reels: ReelStat[],
  opts: { now: Date; recentRepostSources?: Set<string> }
): RepostCandidate[] {
  const now = opts.now.getTime();
  const skip = opts.recentRepostSources ?? new Set<string>();
  const withReach = reels.filter((r) => r.reach !== null && r.reach > 0);
  if (withReach.length === 0) return [];

  const k = Math.max(REPOST_MIN_CANDIDATES, Math.ceil(withReach.length * REPOST_TOP_FRACTION));
  const spr = (r: ReelStat) => (r.shares === null || !r.reach ? null : r.shares / r.reach);
  const topShares = rankTop(withReach, spr, k);
  const topWatch = rankTop(withReach, (r) => r.avgWatchTimeMs, k);
  const topPct = `Top ${Math.round(REPOST_TOP_FRACTION * 100)}%`;

  const out: RepostCandidate[] = [];
  for (const reel of withReach) {
    if (skip.has(reel.id)) continue;
    const posted = Date.parse(reel.timestamp);
    if (!Number.isFinite(posted)) continue;
    const ageDays = (now - posted) / DAY_MS;
    if (ageDays < REPOST_MIN_AGE_DAYS) continue;
    const bySpr = topShares.has(reel);
    const byWatch = topWatch.has(reel);
    if (!bySpr && !byWatch) continue;
    const s = spr(reel);
    const reason = bySpr
      ? `${topPct} by shares/reach (${((s ?? 0) * 100).toFixed(1)}%)`
      : `${topPct} by watch time (${((reel.avgWatchTimeMs ?? 0) / 1000).toFixed(1)}s)`;
    out.push({
      reel,
      sharesPerReach: s,
      avgWatchTimeMs: reel.avgWatchTimeMs,
      reason: bySpr && byWatch ? `${reason}, and watch time` : reason,
      earliestAt: new Date(Math.max(now, posted + REPOST_DEFAULT_GAP_DAYS * DAY_MS)),
      ageDays,
    });
  }
  // Both lists first, then by shares/reach.
  const both = (c: RepostCandidate) => (topShares.has(c.reel) && topWatch.has(c.reel) ? 1 : 0);
  return out.sort(
    (a, b) => both(b) - both(a) || (b.sharesPerReach ?? 0) - (a.sharesPerReach ?? 0)
  );
}

/** The earliest allowed repost time for a reel posted at `originalAt`. */
export function minRepostAt(originalAt: Date): Date {
  return new Date(originalAt.getTime() + REPOST_MIN_GAP_DAYS * DAY_MS);
}
