/**
 * Source videos for hook tests and reposts: a fresh upload (the schedule
 * uploader's file) or one of his posted reels, downloaded from Instagram's
 * short-lived media_url into storage/scheduled/sources (cached for a day so
 * preview → schedule doesn't download twice). Server only.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getMediaById } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { downloadToFile } from "@/lib/server/coach/media";
import { getHookData, type HookPost } from "@/lib/server/hook-coach";
import { absolutePath, readUploadMeta, SCHEDULED_DIR } from "@/lib/scheduling/storage";
import { DAY_MS } from "@/lib/strategy/config";
import { getOlderReels } from "@/lib/strategy/library";
import { probeDurationSec } from "@/lib/strategy/variants";

export const SOURCES_DIR = `${SCHEDULED_DIR}/sources`;
const SOURCE_TTL_MS = DAY_MS;

export type SourceRef = { uploadId: string } | { mediaId: string };

export interface ResolvedSource {
  /** Relative to the project root (inside scheduled storage). */
  relPath: string;
  absPath: string;
  durationSec: number;
  instagramAccountId: string;
  /** Set when the source is one of his reels. */
  mediaId: string | null;
  reel: HookPost | null;
  uploadId: string | null;
}

export class SourceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SourceError";
  }
}

export function parseSourceRef(value: unknown): SourceRef | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.uploadId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v.uploadId)) {
    return { uploadId: v.uploadId };
  }
  if (typeof v.mediaId === "string" && /^\d{5,40}$/.test(v.mediaId)) {
    return { mediaId: v.mediaId };
  }
  return null;
}

/** One of his posts with numbers (last 30, or an older reel), or null. */
export async function findReel(workspaceId: string, mediaId: string): Promise<HookPost | null> {
  const hook = await getHookData(workspaceId);
  if (hook.status !== "ok") return null;
  const recent = hook.data.posts.find((p) => p.id === mediaId);
  if (recent) return recent;
  return (await getOlderReels(workspaceId)).find((p) => p.id === mediaId) ?? null;
}

export async function resolveSource(
  workspaceId: string,
  ref: SourceRef
): Promise<ResolvedSource> {
  const account = await getWorkspaceInstagramAccount(workspaceId, null);
  if (!account) throw new SourceError("Connect an Instagram account first.");

  if ("uploadId" in ref) {
    const meta = await readUploadMeta(ref.uploadId);
    if (!meta || meta.workspaceId !== workspaceId || !meta.finalPath) {
      throw new SourceError("The video isn't uploaded yet. Pick it again.");
    }
    const abs = absolutePath(meta.finalPath);
    if (!existsSync(abs)) throw new SourceError("The upload expired. Pick the video again.");
    return {
      relPath: meta.finalPath,
      absPath: abs,
      durationSec: meta.probe?.durationSec || (await probeDurationSec(abs)),
      instagramAccountId: account.id,
      mediaId: null,
      reel: null,
      uploadId: ref.uploadId,
    };
  }

  const reel = await findReel(workspaceId, ref.mediaId);
  if (!reel) throw new SourceError("That reel isn't in your recent posts.", 404);
  if (!reel.isReel && reel.mediaType !== "VIDEO") {
    throw new SourceError("That post isn't a video.");
  }
  const relPath = `${SOURCES_DIR}/media-${ref.mediaId}.mp4`;
  const abs = absolutePath(relPath);
  const fresh = await stat(abs)
    .then((s) => Date.now() - s.mtimeMs < SOURCE_TTL_MS && s.size > 0)
    .catch(() => false);
  if (!fresh) {
    await mkdir(path.dirname(abs), { recursive: true });
    const token = decryptToken(account.accessToken);
    const media = await getMediaById(token, ref.mediaId, "id,media_type,media_url");
    if (!media.media_url) {
      throw new SourceError("Instagram didn't give a download link for that reel.", 502);
    }
    const tmp = `${abs}.part`;
    try {
      await downloadToFile(media.media_url, tmp);
      await rename(tmp, abs);
    } catch (err) {
      await rm(tmp, { force: true });
      throw new SourceError(
        `Couldn't download the reel: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    }
  }
  return {
    relPath,
    absPath: abs,
    durationSec: await probeDurationSec(abs),
    instagramAccountId: account.id,
    mediaId: ref.mediaId,
    reel,
    uploadId: null,
  };
}

/** Drop downloaded sources older than a day. */
export async function cleanStaleSources(now = Date.now()): Promise<number> {
  const dir = path.resolve(process.cwd(), SOURCES_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    const s = await stat(full).catch(() => null);
    if (s && now - s.mtimeMs > SOURCE_TTL_MS) {
      await rm(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}
