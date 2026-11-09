/**
 * His older reels (beyond Hook Coach's last 30 posts) with numbers, for
 * repost candidates: a reel must be 30+ days old, and someone who posts daily
 * has nothing that old in the last 30. Fetches up to LIBRARY_MAX media once,
 * then insights for the old reels only; cached 12 h in ApiSnapshot.
 * Never throws (an empty list on failure). Server only.
 */

import {
  getAllUserMedia,
  getMediaInsights,
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
import {
  extractHook,
  HOOK_COACH_POST_COUNT,
  normaliseSkipRate,
  type HookPost,
} from "@/lib/server/hook-coach";
import { DAY_MS, REPOST_MIN_AGE_DAYS } from "@/lib/strategy/config";

const LIBRARY_MAX = 120;
const LIBRARY_TTL_MS = 12 * 60 * 60_000;
const CONCURRENCY = 6;
const METRICS = ["views", "reach", "likes", "saved", "shares", "ig_reels_avg_watch_time", "reels_skip_rate"];
const BASIC = ["views", "reach", "likes", "saved", "shares"];

async function insightsFor(token: string, m: InstagramMedia) {
  try {
    return await getMediaInsights(token, m.id, METRICS);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof RateLimitError) throw err;
    return getMediaInsights(token, m.id, BASIC).catch(() => null);
  }
}

function toHookPost(m: InstagramMedia, ins: Awaited<ReturnType<typeof insightsFor>>): HookPost {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const reach = n(ins?.reach);
  const shares = n(ins?.shares);
  const saved = n(ins?.saved);
  const skipRate = normaliseSkipRate(ins?.reels_skip_rate);
  return {
    id: m.id,
    caption: m.caption?.trim() || null,
    hook: extractHook(m.caption),
    mediaType: m.media_product_type ?? m.media_type,
    isReel: true,
    permalink: m.permalink ?? null,
    thumbnailUrl: m.thumbnail_url ?? null,
    timestamp: m.timestamp,
    views: n(ins?.views),
    reach,
    saved,
    shares,
    likes: n(ins?.likes) ?? m.like_count ?? null,
    comments: m.comments_count ?? null,
    avgWatchTimeMs: n(ins?.ig_reels_avg_watch_time),
    skipRate,
    follows: null,
    profileVisits: null,
    hold3s: skipRate === null ? null : 1 - skipRate,
    spreadRate:
      reach && (shares !== null || saved !== null) ? ((shares ?? 0) + (saved ?? 0)) / reach : null,
    followRate: null,
  };
}

/** Reels older than the Hook Coach window, oldest-allowed first. */
export async function getOlderReels(
  workspaceId: string,
  options: { refresh?: boolean } = {}
): Promise<HookPost[]> {
  try {
    const account = await getWorkspaceInstagramAccount(workspaceId, null);
    if (!account) return [];
    const key = buildApiSnapshotKey({
      source: "ig:strategy-library",
      accountId: account.id,
      params: { v: 1, n: LIBRARY_MAX },
    });
    const cached = await getApiSnapshot<HookPost[]>(key, { bypass: options.refresh });
    if (cached) return cached.data;

    const token = decryptToken(account.accessToken);
    const media = await getAllUserMedia(token, LIBRARY_MAX);
    const cutoff = Date.now() - REPOST_MIN_AGE_DAYS * DAY_MS;
    const old = media
      .slice(HOOK_COACH_POST_COUNT)
      .filter((m) => m.media_product_type === "REELS" && Date.parse(m.timestamp) < cutoff);

    const results: HookPost[] = new Array(old.length);
    let cursor = 0;
    let stop = false;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, old.length) }, async () => {
        while (cursor < old.length && !stop) {
          const i = cursor++;
          try {
            results[i] = toHookPost(old[i], await insightsFor(token, old[i]));
          } catch {
            stop = true;
          }
        }
      })
    );
    const posts = results.filter(Boolean);
    await setApiSnapshot(
      { workspaceId, instagramAccountId: account.id, key, source: "ig:strategy-library" },
      posts,
      LIBRARY_TTL_MS
    );
    return posts;
  } catch (err) {
    console.error("[Strategy] older reels failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
