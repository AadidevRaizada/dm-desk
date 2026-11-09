/**
 * Local media plumbing for the Coach reel analyzer: private upload storage,
 * downloads, ffprobe/ffmpeg frame extraction and whisper.cpp transcription.
 *
 * Everything lives under ./storage (gitignored). Uploads are never served
 * statically; /api/coach/uploads/[id] streams them to the signed-in workspace.
 */

import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { MAX_UPLOAD_BYTES } from "@/lib/coach/types";

const exec = promisify(execFile);

export const STORAGE_ROOT = path.join(process.cwd(), "storage");
const UPLOADS_ROOT = path.join(STORAGE_ROOT, "uploads", "coach");
const TMP_ROOT = path.join(STORAGE_ROOT, "tmp", "coach");
const MODELS_ROOT = path.join(STORAGE_ROOT, "models");

export const MAX_FRAMES = 24;
const FRAME_EVERY_SEC = 2;

const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
export const isSafeId = (id: string) => ID_RE.test(id);

/* ------------------------------------------------------------------ */
/* Binaries                                                            */
/* ------------------------------------------------------------------ */

// The launchd service's PATH may not include Homebrew, so check the usual spots.
function findBin(name: string, envVar: string): string | null {
  const candidates = [
    process.env[envVar],
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(c)) ?? null;
}

export const ffmpegBin = () => findBin("ffmpeg", "FFMPEG_BIN");
export const ffprobeBin = () => findBin("ffprobe", "FFPROBE_BIN");
export const whisperBin = () => findBin("whisper-cli", "WHISPER_BIN");

const MODEL_PREFERENCE = [
  "ggml-small.bin",
  "ggml-base.en.bin",
  "ggml-small.en.bin",
  "ggml-base.bin",
  "ggml-tiny.en.bin",
];

export function whisperModel(): string | null {
  const env = process.env.WHISPER_MODEL;
  if (env && existsSync(env)) return env;
  for (const name of MODEL_PREFERENCE) {
    const p = path.join(MODELS_ROOT, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Uploads (chunked, so they pass a 100 MB proxy/tunnel limit)          */
/* ------------------------------------------------------------------ */

export interface UploadMeta {
  id: string;
  workspaceId: string;
  fileName: string;
  ext: ".mp4" | ".mov";
  size: number;
  received: number;
  createdAt: string;
}

function uploadPaths(workspaceId: string, id: string) {
  if (!isSafeId(workspaceId) || !isSafeId(id)) throw new Error("Bad id");
  const dir = path.join(UPLOADS_ROOT, workspaceId);
  return {
    dir,
    meta: path.join(dir, `${id}.json`),
    file: (ext: string) => path.join(dir, `${id}${ext}`),
  };
}

export function uploadExt(fileName: string, type: string): ".mp4" | ".mov" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mov") || type === "video/quicktime") return ".mov";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v") || type === "video/mp4") {
    return ".mp4";
  }
  return null;
}

export async function createUpload(
  workspaceId: string,
  id: string,
  fileName: string,
  ext: ".mp4" | ".mov",
  size: number
): Promise<UploadMeta> {
  if (size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("Bad size");
  const p = uploadPaths(workspaceId, id);
  await fs.mkdir(p.dir, { recursive: true });
  const meta: UploadMeta = {
    id,
    workspaceId,
    fileName: fileName.slice(0, 200),
    ext,
    size,
    received: 0,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(p.file(ext), "");
  await fs.writeFile(p.meta, JSON.stringify(meta));
  return meta;
}

export async function readUpload(
  workspaceId: string,
  id: string
): Promise<(UploadMeta & { path: string }) | null> {
  try {
    const p = uploadPaths(workspaceId, id);
    const meta = JSON.parse(await fs.readFile(p.meta, "utf8")) as UploadMeta;
    if (meta.workspaceId !== workspaceId) return null;
    return { ...meta, path: p.file(meta.ext) };
  } catch {
    return null;
  }
}

/** Append a chunk at `offset`; returns bytes received so far. */
export async function appendUpload(
  workspaceId: string,
  id: string,
  offset: number,
  body: ReadableStream<Uint8Array>
): Promise<number> {
  const meta = await readUpload(workspaceId, id);
  if (!meta) throw new Error("Upload not found");
  const stat = await fs.stat(meta.path);
  if (offset !== stat.size) {
    throw new Error(`Expected offset ${stat.size}`);
  }
  let written = 0;
  const limit = meta.size - stat.size;
  const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
  source.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > limit) source.destroy(new Error("Upload larger than declared"));
  });
  await pipeline(source, createWriteStream(meta.path, { flags: "a" }));
  const received = stat.size + written;
  const p = uploadPaths(workspaceId, id);
  await fs.writeFile(p.meta, JSON.stringify({ ...meta, path: undefined, received }));
  return received;
}

/* ------------------------------------------------------------------ */
/* Download, probe, frames, transcript                                 */
/* ------------------------------------------------------------------ */

export async function makeTmpDir(jobId: string): Promise<string> {
  if (!isSafeId(jobId)) throw new Error("Bad id");
  const dir = path.join(TMP_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) throw new Error("Video is larger than 200 MB");
  let total = 0;
  const source = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  source.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) source.destroy(new Error("Video is larger than 200 MB"));
  });
  await pipeline(source, createWriteStream(dest));
}

export async function probeDuration(file: string): Promise<number | null> {
  const bin = ffprobeBin();
  if (!bin) throw new Error("ffprobe not found (install ffmpeg)");
  const { stdout } = await exec(
    bin,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
    { timeout: 30_000 }
  );
  const d = Number(JSON.parse(stdout)?.format?.duration);
  return Number.isFinite(d) && d > 0 ? d : null;
}

export interface Frame {
  at: number;
  path: string;
}

/** ~1 frame every 2s (spread wider for long videos), max 24, 512px wide JPEG. */
export async function extractFrames(
  file: string,
  dir: string,
  duration: number | null
): Promise<Frame[]> {
  const bin = ffmpegBin();
  if (!bin) throw new Error("ffmpeg not found");
  const interval = Math.max(
    FRAME_EVERY_SEC,
    duration ? duration / MAX_FRAMES : FRAME_EVERY_SEC
  );
  await exec(
    bin,
    [
      "-nostdin",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `fps=1/${interval.toFixed(3)},scale=512:-2`,
      "-q:v",
      "6",
      "-frames:v",
      String(MAX_FRAMES),
      path.join(dir, "f_%03d.jpg"),
    ],
    { timeout: 180_000 }
  );
  const names = (await fs.readdir(dir))
    .filter((n) => /^f_\d+\.jpg$/.test(n))
    .sort();
  return names.map((n, i) => ({
    at: Math.round(i * interval * 10) / 10,
    path: path.join(dir, n),
  }));
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export type TranscriptResult =
  | { ok: true; segments: Segment[] }
  | { ok: false; note: string };

/** Local speech-to-text with whisper.cpp; never throws. */
export async function transcribe(
  file: string,
  dir: string
): Promise<TranscriptResult> {
  const whisper = whisperBin();
  const model = whisperModel();
  const ffmpeg = ffmpegBin();
  if (!whisper || !model || !ffmpeg) {
    return {
      ok: false,
      note: !whisper
        ? "whisper.cpp isn't installed, so this was judged on the pictures and caption only. Run scripts/setup-whisper.sh."
        : "No whisper model found, so this was judged on the pictures and caption only. Run scripts/setup-whisper.sh.",
    };
  }
  const wav = path.join(dir, "audio.wav");
  try {
    await exec(
      ffmpeg,
      ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      { timeout: 120_000 }
    );
  } catch {
    return { ok: false, note: "This video has no audio track." };
  }
  const outBase = path.join(dir, "transcript");
  const lang = /\.en\.bin$/.test(model) ? "en" : "auto";
  try {
    await exec(
      whisper,
      ["-m", model, "-f", wav, "-oj", "-of", outBase, "-np", "-l", lang, "-t", "4"],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const json = JSON.parse(await fs.readFile(`${outBase}.json`, "utf8")) as {
      transcription?: Array<{ offsets?: { from: number; to: number }; text?: string }>;
    };
    const segments = (json.transcription ?? [])
      .map((s) => ({
        start: (s.offsets?.from ?? 0) / 1000,
        end: (s.offsets?.to ?? 0) / 1000,
        text: (s.text ?? "").trim(),
      }))
      .filter((s) => s.text && !/^\[(music|blank_audio|silence)[^\]]*\]$/i.test(s.text));
    if (segments.length === 0) {
      return { ok: false, note: "No speech detected, so this was judged on the pictures and caption." };
    }
    return { ok: true, segments };
  } catch (err) {
    console.error("[Coach] whisper failed:", err instanceof Error ? err.message : err);
    return { ok: false, note: "Transcription failed, so this was judged on the pictures and caption only." };
  }
}
