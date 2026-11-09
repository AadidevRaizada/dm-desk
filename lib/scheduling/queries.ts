import { prisma } from "@/lib/db/client";
import type { InstagramMedia } from "@/lib/meta/client";
import { RECONNECT_PREFIX } from "@/lib/scheduling/rules";

export interface ScheduledPostView {
  id: string;
  instagramAccountId: string;
  username: string;
  caption: string;
  shareToFeed: boolean;
  trialStrategy: string | null;
  scheduledAt: string;
  status: string;
  permalink: string | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  hasCover: boolean;
}

export interface ScheduleData {
  posts: ScheduledPostView[];
  accounts: { id: string; username: string }[];
  /** Timestamps of the account's best posts; the browser turns them into a local hour. */
  topPostTimestamps: string[];
  reconnectNeeded: boolean;
}

/** Top third of cached posts by likes + 3×comments (no extra Meta calls). */
export async function topPostTimestamps(workspaceId: string): Promise<string[]> {
  const snapshots = await prisma.apiSnapshot.findMany({
    where: { workspaceId, source: "ig:posts" },
    orderBy: { fetchedAt: "desc" },
    take: 3,
    select: { payload: true },
  });
  const seen = new Map<string, InstagramMedia>();
  for (const s of snapshots) {
    if (!Array.isArray(s.payload)) continue;
    for (const m of s.payload as unknown as InstagramMedia[]) {
      if (m?.id && m.timestamp && !seen.has(m.id)) seen.set(m.id, m);
    }
  }
  const posts = [...seen.values()];
  if (posts.length < 3) return [];
  const score = (m: InstagramMedia) => (m.like_count ?? 0) + 3 * (m.comments_count ?? 0);
  posts.sort((a, b) => score(b) - score(a));
  return posts.slice(0, Math.max(3, Math.ceil(posts.length / 3))).map((m) => m.timestamp);
}

export async function getScheduleData(workspaceId: string): Promise<ScheduleData> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const [rows, accounts, timestamps] = await Promise.all([
    prisma.scheduledPost.findMany({
      where: {
        workspaceId,
        OR: [
          { status: { in: ["SCHEDULED", "PUBLISHING", "FAILED"] } },
          { publishedAt: { gte: since } },
        ],
      },
      orderBy: { scheduledAt: "asc" },
      take: 200,
      include: { instagramAccount: { select: { username: true } } },
    }),
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "asc" },
      select: { id: true, username: true },
    }),
    topPostTimestamps(workspaceId),
  ]);

  const posts: ScheduledPostView[] = rows.map((r) => ({
    id: r.id,
    instagramAccountId: r.instagramAccountId,
    username: r.instagramAccount.username,
    caption: r.caption,
    shareToFeed: r.shareToFeed,
    trialStrategy: r.trialStrategy,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
    permalink: r.permalink,
    error: r.error,
    attempts: r.attempts,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    hasCover: Boolean(r.coverPath),
  }));

  return {
    posts,
    accounts,
    topPostTimestamps: timestamps,
    reconnectNeeded: posts.some(
      (p) => p.status === "FAILED" && p.error?.startsWith(RECONNECT_PREFIX)
    ),
  };
}
