import { readFile, stat } from "node:fs/promises";
import { prisma } from "@/lib/db/client";
import {
  createReelContainer,
  getContainerStatus,
  getContentPublishingLimit,
  getMediaPermalink,
  getUserMedia,
  MetaApiError,
  publishMediaContainer,
  RateLimitError,
  TokenExpiredError,
  uploadReelVideo,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { RECONNECT_PREFIX } from "@/lib/scheduling/rules";
import {
  absolutePath,
  removeFile,
  signedVideoUrl,
  thumbOffsetFromCover,
} from "@/lib/scheduling/storage";

/**
 * Publishes scheduled reels. Called every minute by the worker loop and by
 * /api/cron/publish-scheduled as a backup; the SCHEDULED → PUBLISHING claim
 * is a guarded updateMany, so overlapping callers never publish twice.
 */

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 10 * 60_000;
export const QUOTA_RETRY_DELAY_MS = 30 * 60_000;
/** A PUBLISHING row untouched this long was interrupted (process restart). */
export const STALE_PUBLISHING_MS = 15 * 60_000;
const BATCH_SIZE = 5;

export interface PublisherOptions {
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** "auto" (resumable, then signed URL), "resumable" or "url". */
  uploadMode?: "auto" | "resumable" | "url";
}

export interface PublishSummary {
  claimed: number;
  published: number;
  rescheduled: number;
  failed: number;
  recovered: number;
}

/** Errors that retrying will not fix. */
export class PublishFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishFatalError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function resolveOptions(opts: PublisherOptions) {
  const mode = (opts.uploadMode ??
    (process.env.SCHEDULE_UPLOAD_MODE as PublisherOptions["uploadMode"]) ??
    "auto") as NonNullable<PublisherOptions["uploadMode"]>;
  return {
    now: opts.now ?? (() => new Date()),
    sleep: opts.sleep ?? defaultSleep,
    pollIntervalMs: opts.pollIntervalMs ?? 10_000,
    pollTimeoutMs: opts.pollTimeoutMs ?? 10 * 60_000,
    uploadMode: ["auto", "resumable", "url"].includes(mode) ? mode : "auto",
  };
}

/** Atomic claim: only one caller can move a due post to PUBLISHING. */
export async function claimPost(id: string, now: Date): Promise<boolean> {
  const result = await prisma.scheduledPost.updateMany({
    where: { id, status: "SCHEDULED", scheduledAt: { lte: now } },
    data: { status: "PUBLISHING" },
  });
  return result.count === 1;
}

export type ErrorKind = "reconnect" | "transient" | "fatal";

export function classifyError(err: unknown): ErrorKind {
  if (err instanceof PublishFatalError) return "fatal";
  if (err instanceof TokenExpiredError) return "reconnect";
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof MetaApiError) {
    if (
      err.code === 10 ||
      err.code === 200 ||
      /permission|not authori[sz]ed|instagram_business_content_publish|\(#10\)|\(#200\)/i.test(message)
    )
      return "reconnect";
    if (err instanceof RateLimitError) return "transient";
    // 2207042: over the 24h publishing cap — try again later.
    if (err.subcode === 2207042 || err.code === 9) return "transient";
    if (err.code === 1 || err.code === 2 || err.code >= 500) return "transient";
    if (/temporar|try again|unexpected error|timeout|timed out/i.test(message))
      return "transient";
    return "fatal";
  }
  // fetch failures, ECONNRESET, DNS, aborted requests
  return "transient";
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/access_token=[^&\s]+/g, "access_token=***").slice(0, 500);
}

export async function publishDuePosts(
  options: PublisherOptions = {}
): Promise<PublishSummary> {
  const opts = resolveOptions(options);
  const summary: PublishSummary = {
    claimed: 0,
    published: 0,
    rescheduled: 0,
    failed: 0,
    recovered: 0,
  };

  summary.recovered = await recoverStalePosts(opts, summary);

  const now = opts.now();
  const due = await prisma.scheduledPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  for (const { id } of due) {
    if (!(await claimPost(id, now))) continue;
    summary.claimed += 1;
    const outcome = await publishClaimedPost(id, opts);
    summary[outcome] += 1;
  }
  return summary;
}

type Outcome = "published" | "rescheduled" | "failed";
type Resolved = ReturnType<typeof resolveOptions>;

async function loadPost(id: string) {
  return prisma.scheduledPost.findUnique({
    where: { id },
    include: {
      instagramAccount: {
        select: { instagramId: true, accessToken: true, username: true },
      },
    },
  });
}

export async function publishClaimedPost(
  id: string,
  opts: Resolved
): Promise<Outcome> {
  const post = await loadPost(id);
  if (!post) return "failed";

  try {
    if (!post.instagramAccount.accessToken) {
      throw new TokenExpiredError("Instagram account has no access token");
    }
    const token = decryptToken(post.instagramAccount.accessToken);
    const igUserId = post.instagramAccount.instagramId;

    // 100 API posts per rolling 24h. If we're at the cap, wait without
    // spending an attempt.
    const limit = await getContentPublishingLimit(token, igUserId).catch(() => null);
    const quotaTotal = limit?.config?.quota_total ?? 100;
    if (limit && limit.quota_usage >= quotaTotal) {
      await prisma.scheduledPost.update({
        where: { id },
        data: {
          status: "SCHEDULED",
          scheduledAt: new Date(opts.now().getTime() + QUOTA_RETRY_DELAY_MS),
          error: `Instagram's limit of ${quotaTotal} API posts a day is used up. Trying again in 30 minutes.`,
        },
      });
      return "rescheduled";
    }

    const absVideo = absolutePath(post.videoPath);
    const size = await stat(absVideo)
      .then((s) => s.size)
      .catch(() => {
        throw new PublishFatalError("The video file is missing on the server. Upload it again.");
      });

    const containerId = await createAndUpload(
      { ...post, size, absVideo, token, igUserId },
      opts
    );

    await waitUntilFinished(id, token, containerId, opts);

    const media = await publishMediaContainer(token, igUserId, containerId);
    const permalink = await getMediaPermalink(token, media.id).catch(() => null);

    await prisma.scheduledPost.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        mediaId: media.id,
        permalink,
        publishedAt: opts.now(),
        error: null,
      },
    });
    // The reel lives on Instagram now; keep only the small cover.
    await removeFile(post.videoPath);
    console.log(`[Scheduler] Published ${id} → ${permalink ?? media.id}`);
    return "published";
  } catch (err) {
    return handleFailure(id, post.attempts, err, opts);
  }
}

async function handleFailure(
  id: string,
  previousAttempts: number,
  err: unknown,
  opts: Resolved
): Promise<Outcome> {
  const kind = classifyError(err);
  const attempts = previousAttempts + 1;
  const message = errorText(err);
  console.error(`[Scheduler] Post ${id} attempt ${attempts} (${kind}): ${message}`);

  if (kind === "transient" && attempts < MAX_ATTEMPTS) {
    await prisma.scheduledPost.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        attempts,
        containerId: null,
        scheduledAt: new Date(opts.now().getTime() + RETRY_DELAY_MS),
        error: `Retrying in 10 minutes: ${message}`,
      },
    });
    return "rescheduled";
  }

  await prisma.scheduledPost.update({
    where: { id },
    data: {
      status: "FAILED",
      attempts,
      error: kind === "reconnect" ? `${RECONNECT_PREFIX}${message}` : message,
    },
  });
  return "failed";
}

interface UploadInput {
  id: string;
  caption: string;
  shareToFeed: boolean;
  coverPath: string | null;
  absVideo: string;
  size: number;
  token: string;
  igUserId: string;
}

async function createAndUpload(post: UploadInput, opts: Resolved): Promise<string> {
  const base = {
    caption: post.caption,
    shareToFeed: post.shareToFeed,
    thumbOffsetMs: thumbOffsetFromCover(post.coverPath),
  };

  const viaUrl = async () => {
    const videoUrl = signedVideoUrl(post.id);
    if (!videoUrl) {
      throw new PublishFatalError(
        "No public HTTPS address to hand Instagram the video (set NEXTAUTH_URL)."
      );
    }
    const container = await createReelContainer(post.token, post.igUserId, {
      ...base,
      videoUrl,
    });
    await saveContainer(post.id, container.id);
    return container.id;
  };

  if (opts.uploadMode === "url") return viaUrl();

  try {
    const container = await createReelContainer(post.token, post.igUserId, base);
    await saveContainer(post.id, container.id);
    const bytes = await readFile(post.absVideo);
    await uploadReelVideo(post.token, container.id, bytes, post.size);
    return container.id;
  } catch (err) {
    // A token/permission problem fails the same way either path; don't mask it.
    if (opts.uploadMode === "resumable" || classifyError(err) === "reconnect") throw err;
    console.warn(
      `[Scheduler] Resumable upload failed for ${post.id} (${errorText(err)}); using signed URL`
    );
    return viaUrl();
  }
}

async function saveContainer(id: string, containerId: string) {
  await prisma.scheduledPost.update({ where: { id }, data: { containerId } });
}

async function waitUntilFinished(
  id: string,
  token: string,
  containerId: string,
  opts: Resolved
): Promise<void> {
  const started = opts.now().getTime();
  for (;;) {
    const status = await getContainerStatus(token, containerId);
    switch (status.status_code) {
      case "FINISHED":
        return;
      case "PUBLISHED":
        throw new PublishFatalError("This container was already published.");
      case "ERROR":
        throw new PublishFatalError(
          `Instagram couldn't process the video${status.status ? `: ${status.status}` : "."}`
        );
      case "EXPIRED":
        throw new PublishFatalError("Instagram's upload expired before publishing.");
    }
    if (opts.now().getTime() - started >= opts.pollTimeoutMs) {
      throw new PublishFatalError(
        "Instagram was still processing the video after 10 minutes."
      );
    }
    // Touch the row so the stale-PUBLISHING sweep knows we're alive.
    await prisma.scheduledPost.update({ where: { id }, data: { containerId } });
    await opts.sleep(opts.pollIntervalMs);
  }
}

/**
 * Rows stuck in PUBLISHING (the process died mid-publish). If Instagram says
 * the container went out, record it as published; otherwise count a failed
 * attempt and retry or fail as usual.
 */
async function recoverStalePosts(opts: Resolved, summary: PublishSummary): Promise<number> {
  const cutoff = new Date(opts.now().getTime() - STALE_PUBLISHING_MS);
  const stale = await prisma.scheduledPost.findMany({
    where: { status: "PUBLISHING", updatedAt: { lt: cutoff } },
    take: BATCH_SIZE,
    include: {
      instagramAccount: { select: { accessToken: true } },
    },
  });
  let recovered = 0;
  for (const post of stale) {
    // Optimistic lock on updatedAt so two sweepers don't both recover it.
    const lock = await prisma.scheduledPost.updateMany({
      where: { id: post.id, status: "PUBLISHING", updatedAt: post.updatedAt },
      data: { status: "PUBLISHING" },
    });
    if (lock.count !== 1) continue;
    recovered += 1;

    if (post.containerId && post.instagramAccount.accessToken) {
      try {
        const token = decryptToken(post.instagramAccount.accessToken);
        const status = await getContainerStatus(token, post.containerId);
        if (status.status_code === "PUBLISHED") {
          const recent = await getUserMedia(token, 10).catch(() => []);
          const match = recent.find((m) => (m.caption ?? "") === post.caption);
          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              status: "PUBLISHED",
              mediaId: match?.id ?? null,
              permalink: match?.permalink ?? null,
              publishedAt: match?.timestamp ? new Date(match.timestamp) : opts.now(),
              error: null,
            },
          });
          await removeFile(post.videoPath);
          summary.published += 1;
          continue;
        }
      } catch {
        // fall through to the normal retry path
      }
    }
    const outcome = await handleFailure(
      post.id,
      post.attempts,
      new Error("Publishing was interrupted (server restarted)."),
      opts
    );
    summary[outcome] += 1;
  }
  return recovered;
}
