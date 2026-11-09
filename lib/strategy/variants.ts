/**
 * Variant rendering for hook tests and reposts (research notes R1, R4).
 *
 * The Homebrew ffmpeg on the Mac has no drawtext (no libfreetype), so the
 * hook is drawn with sharp (libvips + Pango, already installed with Next)
 * into a transparent full-frame PNG and burned in with ffmpeg's overlay
 * filter for the first HOOK_OVERLAY_SEC seconds. Output is always a fresh
 * libx264/AAC encode with +faststart, so it is never byte-identical to the
 * source (checked with a hash anyway).
 *
 * Server only.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  HOOK_FONTS,
  HOOK_POSITION_DEFAULT,
  HOOK_OVERLAY_SEC,
  MAX_HOOK_CHARS,
} from "@/lib/strategy/config";
import { MIN_DURATION_SEC } from "@/lib/scheduling/rules";

const run = promisify(execFile);

function bin(name: "ffmpeg" | "ffprobe"): string {
  const env = name === "ffprobe" ? process.env.FFPROBE_PATH : process.env.FFMPEG_PATH;
  if (env) return env;
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    if (existsSync(`${dir}/${name}`)) return `${dir}/${name}`;
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* Font + sharp                                                        */
/* ------------------------------------------------------------------ */

export function pickFont(): { file: string; pango: string } | null {
  return HOOK_FONTS.find((f) => existsSync(f.file)) ?? null;
}

let sharpPromise: Promise<typeof import("sharp").default> | null = null;

/**
 * Load sharp with a tiny private fontconfig (just the hook font). Without it
 * fontconfig scans every system font on each process start (~10 s).
 */
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = (async () => {
      const font = pickFont();
      if (font && !process.env.FONTCONFIG_FILE) {
        const dir = path.join(process.cwd(), "storage", "strategy", "fontconfig");
        const fontsDir = path.join(dir, "fonts");
        await mkdir(fontsDir, { recursive: true });
        const link = path.join(fontsDir, path.basename(font.file));
        if (!existsSync(link)) await symlink(font.file, link).catch(() => undefined);
        const conf = path.join(dir, "fonts.conf");
        await writeFile(
          conf,
          `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontsDir}</dir>\n  <cachedir>${path.join(dir, "cache")}</cachedir>\n</fontconfig>\n`
        );
        process.env.FONTCONFIG_FILE = conf;
      }
      const mod = await import("sharp");
      return mod.default;
    })();
  }
  return sharpPromise;
}

/* ------------------------------------------------------------------ */
/* Hook overlay                                                        */
/* ------------------------------------------------------------------ */

export function cleanHook(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= MAX_HOOK_CHARS) return t;
  const cut = t.slice(0, MAX_HOOK_CHARS);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

const escapeMarkup = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Full-frame transparent PNG with the hook in a black box: white bold text,
 * wrapped to 80% of the width, top edge at ~16% of the height (below the
 * Reels header, clear of the caption/buttons at the bottom of a 9:16 frame).
 */
export type HookPosition = "top" | "middle";

export async function hookOverlayPng(
  hook: string,
  width: number,
  height: number,
  position: HookPosition = HOOK_POSITION_DEFAULT
): Promise<Buffer> {
  const sharp = await loadSharp();
  const font = pickFont();
  if (!font) throw new Error("No bold font found for the hook text.");
  const text = cleanHook(hook);
  const tall = height >= width * 1.3;
  const maxTextW = Math.round(width * 0.8);
  let size = Math.max(18, Math.round(width * (tall ? 0.06 : 0.045)));

  let rendered: { data: Buffer; info: { width: number; height: number } } | null = null;
  for (let i = 0; i < 6; i++) {
    rendered = await sharp({
      text: {
        text: `<span foreground="white">${escapeMarkup(text)}</span>`,
        font: `${font.pango} ${size}`,
        fontfile: font.file,
        width: maxTextW,
        align: "centre",
        wrap: "word",
        rgba: true,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (rendered.info.height <= height * 0.3) break;
    size = Math.round(size * 0.85);
  }
  if (!rendered) throw new Error("Could not draw the hook text.");

  const padX = Math.round(size * 0.6);
  const padY = Math.round(size * 0.45);
  // A wide, nearly opaque band so an old burned-in title underneath doesn't
  // show through around the new hook.
  const boxW = Math.min(width, Math.max(rendered.info.width + padX * 2, Math.round(width * 0.88)));
  const boxH = rendered.info.height + padY * 2;
  const radius = Math.round(size * 0.35);
  const box = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}"><rect x="0" y="0" width="${boxW}" height="${boxH}" rx="${radius}" ry="${radius}" fill="#000" fill-opacity="0.9"/></svg>`
  );
  const left = Math.max(0, Math.round((width - boxW) / 2));
  const top =
    position === "middle"
      ? Math.round((height - boxH) / 2)
      : Math.round(height * (tall ? 0.16 : 0.08));

  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: box, left, top },
      {
        input: rendered.data,
        left: left + Math.round((boxW - rendered.info.width) / 2),
        top: top + padY,
      },
    ])
    .png()
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* ffmpeg helpers                                                      */
/* ------------------------------------------------------------------ */

export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await run(
    bin("ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
    { timeout: 30_000 }
  );
  const d = Number(JSON.parse(stdout)?.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not read the video length.");
  return d;
}

/** One displayed (auto-rotated) frame as PNG. */
export async function grabFrame(file: string, atSec: number): Promise<Buffer> {
  const { stdout } = await run(
    bin("ffmpeg"),
    ["-v", "error", "-ss", Math.max(0, atSec).toFixed(3), "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
    { timeout: 60_000, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
  );
  if (!stdout?.length) throw new Error("Could not read a frame from the video.");
  return stdout as Buffer;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/* ------------------------------------------------------------------ */
/* Specs                                                               */
/* ------------------------------------------------------------------ */

export interface VariantSpec {
  /** Burned-in hook; null/empty = no overlay. */
  hook: string | null;
  /** Seconds cut off the start (new first frame / tighter open). */
  trimStartSec?: number;
  /** Keep at most this many seconds after the trim ("length" tests). */
  maxDurationSec?: number | null;
  /** Where the hook sits: under the Reels header (default) or mid-frame. */
  hookPosition?: HookPosition;
}

/** Validates a spec against the source length; returns the output length. */
export function plannedDuration(spec: VariantSpec, sourceSec: number): number {
  const trim = Math.max(0, spec.trimStartSec ?? 0);
  let out = sourceSec - trim;
  if (spec.maxDurationSec && spec.maxDurationSec > 0) out = Math.min(out, spec.maxDurationSec);
  if (out < MIN_DURATION_SEC) {
    throw new Error(`That cut leaves under ${MIN_DURATION_SEC} seconds of video.`);
  }
  return out;
}

/** Small JPEG of the variant's first frame with the hook on it (preview). */
export async function previewJpeg(src: string, spec: VariantSpec, widthPx = 360): Promise<Buffer> {
  const sharp = await loadSharp();
  const frame = await grabFrame(src, (spec.trimStartSec ?? 0) + 0.05);
  const meta = await sharp(frame).metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1920;
  const hook = cleanHook(spec.hook);
  let img = sharp(frame);
  if (hook) img = img.composite([{ input: await hookOverlayPng(hook, w, h, spec.hookPosition), left: 0, top: 0 }]);
  const flat = await img.png().toBuffer();
  return sharp(flat).resize({ width: widthPx }).jpeg({ quality: 78 }).toBuffer();
}

/**
 * Render one variant: optional trim, hook overlay for the first seconds,
 * fresh H.264/AAC encode with faststart. Returns the output length and hash.
 */
export async function renderVariantFile(args: {
  src: string;
  out: string;
  spec: VariantSpec;
  /** Written into the container metadata (also guarantees distinct bytes). */
  tag: string;
}): Promise<{ durationSec: number; sha256: string }> {
  const { src, out, spec } = args;
  const sourceSec = await probeDurationSec(src);
  const planned = plannedDuration(spec, sourceSec);
  const trim = Math.max(0, spec.trimStartSec ?? 0);
  const hook = cleanHook(spec.hook);
  await mkdir(path.dirname(out), { recursive: true });

  const overlay = `${out}.hook.png`;
  const input = ["-y", "-v", "error", "-ss", trim.toFixed(3), "-i", src];
  let filter: string[];
  if (hook) {
    const sharp = await loadSharp();
    const frame = await grabFrame(src, trim + 0.05);
    const meta = await sharp(frame).metadata();
    await writeFile(
      overlay,
      await hookOverlayPng(hook, meta.width ?? 1080, meta.height ?? 1920, spec.hookPosition)
    );
    input.push("-i", overlay);
    filter = [
      "-filter_complex",
      `[0:v][1:v]overlay=0:0:enable='lt(t,${HOOK_OVERLAY_SEC})',format=yuv420p[v]`,
      "-map", "[v]",
    ];
  } else {
    filter = ["-vf", "format=yuv420p", "-map", "0:v:0"];
  }
  const args2 = [
    ...input,
    ...(spec.maxDurationSec ? ["-t", planned.toFixed(3)] : []),
    ...filter,
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-movflags", "+faststart",
    "-metadata", `comment=${args.tag}`,
    out,
  ];
  try {
    await run(bin("ffmpeg"), args2, { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    await rm(out, { force: true });
    const msg = err instanceof Error ? err.message.split("\n").slice(-3).join(" ") : String(err);
    throw new Error(`ffmpeg couldn't render the variant: ${msg.slice(0, 300)}`);
  } finally {
    await rm(overlay, { force: true });
  }

  const [durationSec, outHash, srcHash] = await Promise.all([
    probeDurationSec(out),
    sha256File(out),
    sha256File(src),
  ]);
  if (outHash === srcHash) {
    await rm(out, { force: true });
    throw new Error("The re-edit came out identical to the original.");
  }
  return { durationSec, sha256: outHash };
}
