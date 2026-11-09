/**
 * Hook Coach data loader.
 *
 * Loads the creator's last ~30 posts with per-media insights and derives the
 * numbers the Hook Coach page and API need: 3-second hold, spread rate and
 * follow rate, plus the "hook" (first line of the caption).
 *
 * Metric support varies by media type, account and Graph API version, so
 * insights are fetched defensively: a metric Meta rejects is dropped and the
 * request retried, and a post whose insights can't be read at all just gets
 * nulls. Nothing here should throw past `getHookData` — callers get a
 * discriminated result instead.
 *
 * Results are cached for 30 minutes in the durable `ApiSnapshot` table (the
 * same store the Overview page uses).
 */

import type { InstagramAccount } from "@/app/generated/prisma/client";
import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
  RateLimitError,
  TokenExpiredError,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  buildApiSnapshotKey,
  getApiSnapshot,
  setApiSnapshot,
} from "@/lib/server/api-snapshots";

export const HOOK_COACH_POST_COUNT = 30;
export const HOOK_COACH_TTL_SECONDS = 30 * 60;
const INSIGHTS_CONCURRENCY = 6;
const MAX_HOOK_CHARS = 120;
// Bump when the payload shape changes so stale snapshots are ignored.
const SNAPSHOT_VERSION = 2;

// follows / profile_visits are only valid for FEED and STORY media, so they
// are never requested for reels.
const REEL_METRICS = [
  "views",
  "reach",
  "saved",
  "shares",
  "likes",
  "comments",
  "ig_reels_avg_watch_time",
  "reels_skip_rate",
] as const;

const OTHER_METRICS = [
  "views",
  "reach",
  "saved",
  "shares",
  "likes",
  "comments",
  "follows",
  "profile_visits",
] as const;

// Retried alone when the full reel set fails for an unparseable reason.
const CORE_METRICS = ["reach", "saved", "shares", "likes", "comments"];

export interface HookPost {
  id: string;
  caption: string | null;
  /** First line of the caption, capped at ~120 chars. */
  hook: string;
  mediaType: string;
  isReel: boolean;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
  views: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  likes: number | null;
  comments: number | null;
  /** Average watch time in milliseconds (reels only). */
  avgWatchTimeMs: number | null;
  /** Share of plays skipped in the first 3 seconds, 0-1 (reels only). */
  skipRate: number | null;
  follows: number | null;
  profileVisits: number | null;
  /** 1 - skipRate, 0-1. */
  hold3s: number | null;
  /** (shares + saved) / reach, 0-1. */
  spreadRate: number | null;
  /** follows / reach, 0-1. */
  followRate: number | null;
}

export interface HookData {
  account: { id: string; username: string };
  fetchedAt: string;
  /** False when no post returned any insight (usually a missing permission). */
  insightsAvailable: boolean;
  /** True when Meta refused insights with a permission-style error. */
  permissionDenied: boolean;
  posts: HookPost[];
  summary: {
    postCount: number;
    reelsWithHold: number;
    avgHold3s: number | null;
    avgSpreadRate: number | null;
  };
}

export type HookDataResult =
  | { status: "ok"; data: HookData }
  | { status: "no_account" }
  | { status: "error"; message: string };

type Account = Pick<
  InstagramAccount,
  "id" | "instagramId" | "username" | "accessToken"
>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

/** First line of the caption (or ~120 chars, cut at a word boundary). */
export function extractHook(caption: string | null | undefined): string {
  if (!caption) return "";
  const firstLine =
    caption
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (firstLine.length <= MAX_HOOK_CHARS) return firstLine;
  const cut = firstLine.slice(0, MAX_HOOK_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function ratio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

/** Meta documents skip rate as a percentage, but accept 0-1 too. */
export function normaliseSkipRate(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return null;
  }
  const fraction = value > 1 ? value / 100 : value;
  return Math.min(Math.max(fraction, 0), 1);
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Work out which requested metric(s) a Meta error is complaining about.
 * Meta's invalid-metric errors look like either
 *   "(#100) metric[7] must be one of the following values: ..."
 * or
 *   "... does not support the reels_skip_rate metric ...".
 * The first form lists *valid* names too, so we only trust the index.
 */
function offendingMetrics(message: string, requested: string[]): string[] {
  const found = new Set<string>();
  for (const match of message.matchAll(/metric\[(\d+)\]/gi)) {
    const metric = requested[Number(match[1])];
    if (metric) found.add(metric);
  }
  for (const match of message.matchAll(
    /support(?:s|ed)?\s+(?:for\s+)?(?:the\s+)?['"]?([a-z_]+)['"]?\s+metric/gi
  )) {
    if (requested.includes(match[1])) found.add(match[1]);
  }
  return [...found];
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

/** Requested metric → value; null when Meta returned nothing for it. */
type InsightValues = Record<string, number | null | undefined>;

interface InsightRunState {
  /** Metrics Meta has rejected for a media kind during this run. */
  rejected: { reel: Set<string>; other: Set<string> };
  permissionDenied: boolean;
  rateLimited: boolean;
}

async function tryInsights(
  accessToken: string,
  mediaId: string,
  metrics: string[]
): Promise<{ ok: true; values: InsightValues } | { ok: false; error: unknown }> {
  try {
    const values: InsightValues = await getMediaInsights(
      accessToken,
      mediaId,
      metrics
    );
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error };
  }
}

async function fetchInsightsFor(
  accessToken: string,
  media: InstagramMedia,
  isReel: boolean,
  state: InsightRunState
): Promise<InsightValues | null> {
  if (state.rateLimited) return null;
  const rejected = isReel ? state.rejected.reel : state.rejected.other;
  const wanted: readonly string[] = isReel ? REEL_METRICS : OTHER_METRICS;

  let metrics = wanted.filter((m) => !rejected.has(m));
  let usedCoreFallback = false;

  for (let attempt = 0; attempt < 5 && metrics.length > 0; attempt++) {
    const result = await tryInsights(accessToken, media.id, metrics);
    if (result.ok) {
      if (!usedCoreFallback) return result.values;

      // The full set failed for an unknown reason but the core set worked:
      // probe the remaining metrics one at a time so the reel-only numbers
      // (skip rate, watch time) still come through, and remember failures.
      const values = { ...result.values };
      for (const extra of wanted) {
        if (extra in values || rejected.has(extra)) continue;
        const single = await tryInsights(accessToken, media.id, [extra]);
        if (single.ok) Object.assign(values, single.values);
        else rejected.add(extra);
      }
      return values;
    }

    const { error } = result;
    if (error instanceof TokenExpiredError) return null;
    if (error instanceof RateLimitError) {
      state.rateLimited = true;
      return null;
    }

    const message = error instanceof Error ? error.message : String(error);
    const bad = offendingMetrics(message, metrics);
    if (bad.length > 0) {
      for (const m of bad) rejected.add(m);
      metrics = metrics.filter((m) => !bad.includes(m));
      continue;
    }

    if (!usedCoreFallback) {
      usedCoreFallback = true;
      metrics = CORE_METRICS.filter((m) => !rejected.has(m));
      continue;
    }

    // Even the core set failed: most likely the insights permission.
    if (error instanceof PermissionError) state.permissionDenied = true;
    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

function num(values: InsightValues | null, key: string): number | null {
  const v = values?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function buildHookData(account: Account): Promise<HookData> {
  const accessToken = decryptToken(account.accessToken);
  const media = await getAllUserMedia(accessToken, HOOK_COACH_POST_COUNT);

  const state: InsightRunState = {
    rejected: { reel: new Set(), other: new Set() },
    permissionDenied: false,
    rateLimited: false,
  };

  const insights = await mapWithConcurrency(
    media,
    INSIGHTS_CONCURRENCY,
    (m) =>
      fetchInsightsFor(
        accessToken,
        m,
        m.media_product_type === "REELS",
        state
      )
  );

  const posts: HookPost[] = media.map((m, i) => {
    const ins = insights[i];
    const isReel = m.media_product_type === "REELS";
    const reach = num(ins, "reach");
    const saved = num(ins, "saved");
    const shares = num(ins, "shares");
    const follows = num(ins, "follows");
    const skipRate = isReel
      ? normaliseSkipRate(ins?.reels_skip_rate)
      : null;

    return {
      id: m.id,
      caption: m.caption?.trim() || null,
      hook: extractHook(m.caption),
      mediaType: m.media_product_type ?? m.media_type,
      isReel,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp,
      views: num(ins, "views"),
      reach,
      saved,
      shares,
      // Basic media fields carry likes/comments even without insights.
      likes: num(ins, "likes") ?? m.like_count ?? null,
      comments: num(ins, "comments") ?? m.comments_count ?? null,
      avgWatchTimeMs: isReel ? num(ins, "ig_reels_avg_watch_time") : null,
      skipRate,
      follows,
      profileVisits: num(ins, "profile_visits"),
      hold3s: skipRate === null ? null : 1 - skipRate,
      spreadRate:
        shares === null && saved === null
          ? null
          : ratio((shares ?? 0) + (saved ?? 0), reach),
      followRate: ratio(follows, reach),
    };
  });

  return {
    account: { id: account.id, username: account.username },
    fetchedAt: new Date().toISOString(),
    insightsAvailable: insights.some((v) => v !== null),
    permissionDenied: state.permissionDenied,
    posts,
    summary: {
      postCount: posts.length,
      reelsWithHold: posts.filter((p) => p.hold3s !== null).length,
      avgHold3s: average(posts.map((p) => p.hold3s)),
      avgSpreadRate: average(posts.map((p) => p.spreadRate)),
    },
  };
}

/**
 * Load Hook Coach data for a workspace's Instagram account (the most recently
 * connected one when `accountId` is omitted). Never throws.
 */
export async function getHookData(
  workspaceId: string,
  accountId?: string | null,
  options: { refresh?: boolean } = {}
): Promise<HookDataResult> {
  try {
    const account = await getWorkspaceInstagramAccount(
      workspaceId,
      accountId ?? null
    );
    if (!account) return { status: "no_account" };

    const key = buildApiSnapshotKey({
      source: "ig:hook-coach",
      accountId: account.id,
      params: { v: SNAPSHOT_VERSION, n: HOOK_COACH_POST_COUNT },
    });

    const cached = await getApiSnapshot<HookData>(key, {
      bypass: options.refresh,
    });
    if (cached) return { status: "ok", data: cached.data };

    const data = await buildHookData(account);
    await setApiSnapshot(
      {
        workspaceId,
        instagramAccountId: account.id,
        key,
        source: "ig:hook-coach",
      },
      data,
      HOOK_COACH_TTL_SECONDS * 1000
    );
    return { status: "ok", data };
  } catch (err) {
    console.error(
      "[Hook Coach] Failed to load data:",
      err instanceof Error ? err.message : err
    );
    if (err instanceof TokenExpiredError) {
      return {
        status: "error",
        message:
          "Your Instagram connection has expired. Reconnect your account to see your hooks.",
      };
    }
    if (err instanceof RateLimitError) {
      return {
        status: "error",
        message:
          "Instagram is asking us to slow down. Try again in a few minutes.",
      };
    }
    return {
      status: "error",
      message: "We couldn't load your posts from Instagram right now.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Ranking helpers shared by the page and API                          */
/* ------------------------------------------------------------------ */

/** Which metric to rank hooks by: hold3s when enough reels have it. */
export function rankingMetric(posts: HookPost[]): "hold3s" | "spreadRate" {
  const withHold = posts.filter((p) => p.hold3s !== null).length;
  return withHold >= 4 ? "hold3s" : "spreadRate";
}

/** Posts sorted strongest hook first; posts without the metric are dropped. */
export function rankPosts(posts: HookPost[]) {
  const metric = rankingMetric(posts);
  const ranked = posts
    .filter((p) => p[metric] !== null)
    .sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0));
  return { metric, ranked };
}
