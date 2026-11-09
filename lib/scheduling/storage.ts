import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { durationProblem, MAX_VIDEO_BYTES } from "@/lib/scheduling/rules";

/**
 * Disk storage for scheduled reels on the always-on Mac:
 *   storage/scheduled/<postId>.mp4              the video until it is published
 *   storage/scheduled/<postId>.t<ms>.jpg        cover frame (<ms> = thumb_offset)
 *   storage/scheduled/uploads/<uploadId>.*      chunked uploads in progress
 * Paths saved in the database are relative to the project root.
 */

const run = promisify(execFile);

export const SCHEDULED_DIR = "storage/scheduled";
const UPLOADS_DIR = `${SCHEDULED_DIR}/uploads`;
const STALE_UPLOAD_MS = 24 * 60 * 60_000;

function bin(name: "ffprobe" | "ffmpeg"): string {
  const env = name === "ffprobe" ? process.env.FFPROBE_PATH : process.env.FFMPEG_PATH;
  if (env) return env;
  const brew = `/opt/homebrew/bin/${name}`;
  return existsSync(brew) ? brew : name;
}

export function absolutePath(relative: string): string {
  const root = path.resolve(process.cwd(), SCHEDULED_DIR);
  const abs = path.resolve(process.cwd(), relative);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path is outside scheduled storage");
  }
  return abs;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export function isSafeId(id: string): boolean {
  return ID_RE.test(id);
}

export async function ensureDirs(): Promise<void> {
  await mkdir(path.resolve(process.cwd(), UPLOADS_DIR), { recursive: true });
}

/* ------------------------------------------------------------ uploads */

export interface UploadMeta {
  uploadId: string;
  workspaceId: string;
  userId: string;
  ext: "mp4" | "mov";
  total: number;
  createdAt: string;
  probe?: VideoProbe;
  /** Final file (relative) once the upload is complete and checked. */
  finalPath?: string;
}

export function uploadPaths(uploadId: string, ext: string) {
  if (!isSafeId(uploadId)) throw new Error("Bad upload id");
  return {
    data: `${UPLOADS_DIR}/${uploadId}.part.${ext}`,
    meta: `${UPLOADS_DIR}/${uploadId}.json`,
  };
}

export async function readUploadMeta(uploadId: string): Promise<UploadMeta | null> {
  if (!isSafeId(uploadId)) return null;
  try {
    const raw = await readFile(absolutePath(`${UPLOADS_DIR}/${uploadId}.json`), "utf8");
    return JSON.parse(raw) as UploadMeta;
  } catch {
    return null;
  }
}

export async function writeUploadMeta(meta: UploadMeta): Promise<void> {
  await writeFile(
    absolutePath(`${UPLOADS_DIR}/${meta.uploadId}.json`),
    JSON.stringify(meta)
  );
}

export async function fileSize(relative: string): Promise<number> {
  try {
    return (await stat(absolutePath(relative))).size;
  } catch {
    return 0;
  }
}

export async function removeUpload(uploadId: string): Promise<void> {
  if (!isSafeId(uploadId)) return;
  const dir = path.resolve(process.cwd(), UPLOADS_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((n) => n.startsWith(uploadId + "."))
      .map((n) => rm(path.join(dir, n), { force: true }))
  );
}

/** Drop uploads that were never scheduled (older than a day). */
export async function cleanStaleUploads(now = Date.now()): Promise<void> {
  const dir = path.resolve(process.cwd(), UPLOADS_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    const full = path.join(dir, name);
    const s = await stat(full).catch(() => null);
    if (s && now - s.mtimeMs > STALE_UPLOAD_MS) await rm(full, { force: true });
  }
}

/* ------------------------------------------------------------ ffmpeg */

export interface VideoProbe {
  durationSec: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string;
}

export async function probeVideo(absFile: string): Promise<VideoProbe> {
  const { stdout } = await run(
    bin("ffprobe"),
    [
      "-v", "error",
      "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height",
      "-of", "json",
      absFile,
    ],
    { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("That file has no video track.");
  return {
    durationSec: Number(data.format?.duration ?? 0),
    width: video.width ?? null,
    height: video.height ?? null,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    formatName: data.format?.format_name ?? "",
  };
}

/** Returns a reason the video can't be a Reel, or null when it is fine. */
export function probeProblem(probe: VideoProbe, size: number): string | null {
  if (size > MAX_VIDEO_BYTES) return "Videos can be 300 MB at most.";
  if (!/mov|mp4/.test(probe.formatName)) return "Pick an MP4 or MOV video.";
  return durationProblem(probe.durationSec);
}

/**
 * Meta wants the moov atom at the front. Remux (no re-encode) into MP4 with
 * faststart; if ffmpeg can't, keep the original.
 */
export async function faststartRemux(absIn: string, absOut: string): Promise<boolean> {
  try {
    await run(
      bin("ffmpeg"),
      ["-y", "-v", "error", "-i", absIn, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", absOut],
      { timeout: 5 * 60_000 }
    );
    return (await stat(absOut)).size > 0;
  } catch {
    await rm(absOut, { force: true });
    return false;
  }
}

/** Grab one frame as a small JPEG for the list (and to remember the offset). */
export async function extractCover(absVideo: string, offsetMs: number, absOut: string): Promise<boolean> {
  try {
    await run(
      bin("ffmpeg"),
      ["-y", "-v", "error", "-ss", (offsetMs / 1000).toFixed(3), "-i", absVideo, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", absOut],
      { timeout: 60_000 }
    );
    return (await stat(absOut)).size > 0;
  } catch {
    return false;
  }
}

export function coverRelPath(postId: string, offsetMs: number): string {
  return `${SCHEDULED_DIR}/${postId}.t${Math.max(0, Math.round(offsetMs))}.jpg`;
}

/** thumb_offset is kept in the cover file name (the table has no column for it). */
export function thumbOffsetFromCover(coverPath: string | null): number | null {
  const m = coverPath?.match(/\.t(\d+)\.jpg$/);
  return m ? Number(m[1]) : null;
}

export async function moveIntoPlace(fromRel: string, toRel: string): Promise<void> {
  await rename(absolutePath(fromRel), absolutePath(toRel));
}

export async function removeFile(relative: string | null | undefined): Promise<void> {
  if (!relative) return;
  try {
    await rm(absolutePath(relative), { force: true });
  } catch {
    // outside storage or already gone
  }
}

/* -------------------------------------------- signed public video URL */

function signingSecret(): string {
  const secret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return secret;
}

export function signMediaToken(postId: string, expiresAtSec: number): string {
  return createHmac("sha256", signingSecret())
    .update(`scheduled-media:${postId}:${expiresAtSec}`)
    .digest("base64url");
}

export function verifyMediaToken(postId: string, exp: string | null, sig: string | null, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expires = Number(exp);
  if (expires < nowSec) return false;
  const expected = Buffer.from(signMediaToken(postId, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Short-lived link Meta can fetch the video from (fallback when the resumable
 * upload isn't accepted for Instagram Login tokens).
 */
export function signedVideoUrl(postId: string, ttlSec = 2 * 60 * 60): string | null {
  const base = process.env.SCHEDULE_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL;
  if (!base || !base.startsWith("https://")) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const url = new URL(`/api/schedule/media/${postId}`, base);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", signMediaToken(postId, exp));
  return url.toString();
}
