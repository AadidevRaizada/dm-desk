/**
 * Reel scheduling rules shared by the browser form and the server.
 * Limits come from Meta's Reels spec for the Content Publishing API:
 * MP4/MOV, ≤ 300 MB, 3 s – 15 min, caption ≤ 2,200 chars and ≤ 30 hashtags.
 * Pure module: safe to import from client components.
 */

export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MIN_DURATION_SEC = 3;
export const MAX_DURATION_SEC = 15 * 60;
export const MAX_CAPTION_CHARS = 2200;
export const MAX_HASHTAGS = 30;
export const ALLOWED_EXTENSIONS = ["mp4", "mov"] as const;
/** Upload chunk size: stays well under Cloudflare's 100 MB request cap. */
export const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;

export const POST_STATUSES = [
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Error text prefix that tells the UI to show the "Reconnect Instagram" banner. */
export const RECONNECT_PREFIX = "Reconnect Instagram: ";

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(ext: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export function countHashtags(caption: string): number {
  return (caption.match(/(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/** Length as Instagram counts it (code points, so emoji count once). */
export function captionLength(caption: string): number {
  return Array.from(caption).length;
}

export function captionProblem(caption: string): string | null {
  if (captionLength(caption) > MAX_CAPTION_CHARS)
    return `Caption is over ${MAX_CAPTION_CHARS} characters.`;
  if (countHashtags(caption) > MAX_HASHTAGS)
    return `Instagram allows ${MAX_HASHTAGS} hashtags at most.`;
  return null;
}

export function durationProblem(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0)
    return "Could not read the video length.";
  if (seconds < MIN_DURATION_SEC) return "Reels must be at least 3 seconds.";
  if (seconds > MAX_DURATION_SEC) return "Reels can be 15 minutes at most.";
  return null;
}
