/**
 * Reel analyzer ("watch the whole video"): download or load the video,
 * ffprobe its length, pull ~1 frame per 2s, transcribe locally with
 * whisper.cpp, then send frames + transcript + caption + his numbers + the
 * persona to Claude for a score, a second-by-second breakdown, viral hooks and
 * CTA scripts.
 *
 * Runs as an in-process background job (the self-hosted Next server is a
 * long-lived process): the API creates a pending CoachAnalysis row and returns
 * at once; the UI polls the row. Status and stage live in `result`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { generateText, type ModelMessage } from "ai";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getMediaById } from "@/lib/meta/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getHookData, type HookPost } from "@/lib/server/hook-coach";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";
import type { HookCoachProfileData } from "@/lib/hook-coach-story";
import type {
  AnalyzeInput,
  AnalyzeResult,
  AnalyzeSection,
  AnalyzeStage,
  CoachPersonaData,
  CtaScript,
  ExpectedRetention,
} from "@/lib/coach/types";
import { clock } from "@/lib/coach/types";
import { resolvePersona } from "@/lib/server/coach/personas";
import {
  cleanRetention,
  knownDurations,
  retentionStats,
  RETENTION_RULES,
  RETENTION_SHAPE,
  statsText,
  type RetentionStats,
} from "@/lib/server/coach/retention";
import {
  coachModel,
  contextBlock,
  describePost,
  MAX_HOOK_WORDS,
  parseJsonObject,
  str,
  systemPrompt,
} from "@/lib/server/coach/prompting";
import {
  downloadToFile,
  extractFrames,
  makeTmpDir,
  probeDuration,
  readUpload,
  removeDir,
  transcribe,
  type Segment,
} from "@/lib/server/coach/media";

const MODEL_TIMEOUT_MS = 240_000;
const MAX_CONCURRENT_JOBS = 2;

/* ------------------------------------------------------------------ */
/* Core: analyze a local video file (no DB, testable from a script)    */
/* ------------------------------------------------------------------ */

export interface AnalyzeVideoArgs {
  file: string;
  workDir: string;
  caption: string;
  /** "Your reel" description with its numbers, or a note that it's unposted. */
  reelLine: string;
  /** Top/bottom posts block, may be empty. */
  contextText: string;
  stats: RetentionStats;
  profile: HookCoachProfileData;
  persona: CoachPersonaData;
  posted: boolean;
  actual?: ExpectedRetention["actual"];
  onStage?: (stage: AnalyzeStage) => Promise<void> | void;
}

export interface AnalyzeVideoOutput {
  result: AnalyzeResult;
  expectedRetention?: ExpectedRetention;
  rawText: string;
}

function transcriptText(segments: Segment[]): string {
  return segments
    .map((s) => `[${clock(s.start)}–${clock(s.end)}] ${s.text}`)
    .join("\n");
}

const ANALYZE_SHAPE = `{"score": number 0-5 with one decimal, "verdict": "3-7 word verdict, e.g. 'Strong hook, slow middle'", "summary": "2-3 sentences: what works, what loses people, the one biggest fix", "sections": [{"label": "Hook" | "Content" | "Re-hook" | "Payoff" | "Close", "start": seconds, "end": seconds, "note": "what happens on screen and in the audio, and how it lands", "change": "one concrete change (optional, omit if the section is fine)"}], "viralHooks": ["3 alternative opening lines (<= ${MAX_HOOK_WORDS} words) that would have made this go viral, in his voice"], "ctaScripts": [{"text": "a spoken CTA that drives shares and saves, ending with his CTA", "placementSec": seconds where to say it}], "expectedRetention": ${RETENTION_SHAPE}}`;

function clampNum(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, lo), hi);
}

function parseClock(v: unknown): number | null {
  if (typeof v === "string" && /^\d+:\d{1,2}(\.\d+)?$/.test(v.trim())) {
    const [m, s] = v.trim().split(":");
    return Number(m) * 60 + Number(s);
  }
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

export function cleanAnalyzeJson(
  parsed: Record<string, unknown>,
  duration: number | null
): Omit<AnalyzeResult, "status"> {
  const maxT = duration ?? 600;
  const score = clampNum(parsed.score, 0, 5);
  const sections: AnalyzeSection[] = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((s): AnalyzeSection | null => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const start = parseClock(o.start);
      const end = parseClock(o.end);
      const note = str(o.note) || str(o.notes);
      if (start === null || !note) return null;
      const st = Math.min(Math.max(start, 0), maxT);
      const en = Math.min(Math.max(end ?? st, st), maxT);
      const change = str(o.change) || str(o.fix);
      return {
        label: str(o.label) || "Section",
        start: Math.round(st * 10) / 10,
        end: Math.round(en * 10) / 10,
        note,
        ...(change ? { change } : {}),
      };
    })
    .filter((s): s is AnalyzeSection => s !== null)
    .sort((a, b) => a.start - b.start)
    .slice(0, 12);
  const viralHooks = (Array.isArray(parsed.viralHooks) ? parsed.viralHooks : [])
    .map((h) => (typeof h === "string" ? h : str((h as Record<string, unknown>)?.text)))
    .map((h) => h.trim().replace(/^["“]|["”]$/g, ""))
    .filter(Boolean)
    .slice(0, 3);
  const ctaScripts: CtaScript[] = (Array.isArray(parsed.ctaScripts) ? parsed.ctaScripts : [])
    .map((c): CtaScript | null => {
      if (typeof c === "string") return c.trim() ? { text: c.trim(), placementSec: null } : null;
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      const text = str(o.text) || str(o.script);
      if (!text) return null;
      const at = parseClock(o.placementSec ?? o.placement ?? o.at);
      return { text, placementSec: at === null ? null : Math.min(Math.max(at, 0), maxT) };
    })
    .filter((c): c is CtaScript => c !== null)
    .slice(0, 2);
  return {
    score: score === null ? undefined : Math.round(score * 10) / 10,
    verdict: str(parsed.verdict) || undefined,
    summary: str(parsed.summary) || undefined,
    sections,
    viralHooks,
    ctaScripts,
  };
}

export async function analyzeVideoFile(
  args: AnalyzeVideoArgs
): Promise<AnalyzeVideoOutput> {
  const model = coachModel();
  if (!model) throw new Error("ANTHROPIC_API_KEY is missing on the server.");

  const duration = await probeDuration(args.file);
  await args.onStage?.("frames");
  const frames = await extractFrames(args.file, args.workDir, duration);
  if (frames.length === 0) throw new Error("Couldn't read any frames from this video.");
  await args.onStage?.("transcribing");
  const transcript = await transcribe(args.file, args.workDir);
  await args.onStage?.("thinking");

  const header = [
    args.contextText,
    statsText(args.stats),
    "",
    args.posted ? "THE REEL TO REVIEW (already posted):" : "THE REEL TO REVIEW (NOT posted yet; he wants to check it before posting):",
    args.reelLine,
    `Length: ${duration ? `${duration.toFixed(1)}s (${clock(duration)})` : "unknown"}`,
    `Caption: "${args.caption.slice(0, 1500) || "(none)"}"`,
    "",
    transcript.ok
      ? `TRANSCRIPT (timestamped, from local speech-to-text, may have small errors):\n${transcriptText(transcript.segments)}`
      : `TRANSCRIPT: unavailable. ${transcript.note}`,
    "",
    `FRAMES: ${frames.length} stills, one every ~${frames.length > 1 ? (frames[1].at - frames[0].at).toFixed(0) : "?"}s, each labelled with its timestamp. Read on-screen text from them.`,
  ].join("\n");

  const content: Extract<ModelMessage, { role: "user" }>["content"] = [
    { type: "text", text: header },
  ];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at ${clock(f.at)} (${f.at}s):` });
    content.push({ type: "file", mediaType: "image/jpeg", data: await fs.readFile(f.path) });
  }
  content.push({
    type: "text",
    text: `You have now watched the whole reel. Review it like a top short-form editor would.
1. Score it 0-5 (one decimal) as a story: HOOK -> CONTENT -> (RE-HOOK ->) PAYOFF with his CTA. 5 = would go viral as is.
2. Break it down second by second: contiguous sections from 0:00 to the end. The first section is the Hook (usually 0:00 to 0:03-0:06), the last is the Close/Payoff. For each section say what happens (visual + audio + on-screen text) and how it lands; add one concrete "change" where it would help (exact words, cut points or on-screen text).
3. Write 3 hooks that would have made it go viral (his voice, <= ${MAX_HOOK_WORDS} words each).
4. Write 2 CTA scripts that would drive more shares and saves, each with the second to place it.
5. ${RETENTION_RULES} ${args.posted ? "Estimate the retention this reel would get WITH your changes applied." : "Estimate the retention this cut would get if posted as is."}
Ground every claim in what you saw in the frames and heard in the transcript. If the transcript is missing, say so in the summary and judge visuals + caption.

JSON shape:
${ANALYZE_SHAPE}`,
  });

  const { text, finishReason } = await generateText({
    model,
    system: systemPrompt(args.profile, args.persona),
    messages: [{ role: "user", content }],
    maxOutputTokens: 10_000,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    maxRetries: 1,
  });

  const parsed = parseJsonObject(text);
  if (!parsed) {
    console.error(
      `[Coach] Unparseable analyze reply (finish=${finishReason}, ${text.length} chars): ${text.slice(0, 300)}`
    );
    throw new Error("The coach's answer came back garbled. Tap Redo.");
  }
  const cleaned = cleanAnalyzeJson(parsed, duration);
  const expectedRetention = cleanRetention(parsed.expectedRetention, args.stats, {
    storySeconds: duration,
    actual: args.actual,
  });

  return {
    rawText: text,
    expectedRetention,
    result: {
      status: "done",
      ...cleaned,
      durationSec: duration,
      frameCount: frames.length,
      transcribed: transcript.ok,
      ...(transcript.ok ? {} : { transcriptNote: transcript.note }),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Job runner                                                          */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as {
  __coachJobs?: { running: Set<string>; queue: string[] };
};
const jobs = (g.__coachJobs ??= { running: new Set(), queue: [] });

async function patchResult(id: string, patch: Partial<AnalyzeResult>) {
  const row = await prisma.coachAnalysis.findUnique({ where: { id }, select: { result: true } });
  const current = (row?.result ?? {}) as Record<string, unknown>;
  await prisma.coachAnalysis.update({
    where: { id },
    data: { result: JSON.parse(JSON.stringify({ ...current, ...patch })) as Prisma.InputJsonValue },
  });
}

/** Queue an analyze job; at most two run at once in this process. */
export function startAnalyzeJob(id: string) {
  if (jobs.running.has(id) || jobs.queue.includes(id)) return;
  jobs.queue.push(id);
  pump();
}

function pump() {
  while (jobs.running.size < MAX_CONCURRENT_JOBS && jobs.queue.length > 0) {
    const id = jobs.queue.shift()!;
    jobs.running.add(id);
    void runAnalyzeJob(id)
      .catch((err) => console.error("[Coach] analyze job crashed:", err))
      .finally(() => {
        jobs.running.delete(id);
        pump();
      });
  }
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/garbled|ANTHROPIC|larger than|ffmpeg|ffprobe|frames|Connect|isn't/i.test(msg)) return msg;
  if (/timeout|aborted/i.test(msg)) return "That took too long. Tap Redo to try again.";
  return "Something went wrong analyzing this reel. Tap Redo to try again.";
}

async function runAnalyzeJob(id: string) {
  const row = await prisma.coachAnalysis.findUnique({
    where: { id },
    select: { workspaceId: true, personaId: true, input: true, mediaId: true },
  });
  if (!row) return;
  const input = (row.input ?? {}) as unknown as AnalyzeInput & { instagramAccountId?: string };
  let workDir: string | null = null;

  try {
    const [hook, profile, persona, durations] = await Promise.all([
      getHookData(row.workspaceId, input.instagramAccountId),
      getHookCoachProfile(row.workspaceId),
      resolvePersona(row.workspaceId, row.personaId),
      knownDurations(row.workspaceId).catch(() => new Map<string, number>()),
    ]);
    const data = hook.status === "ok" ? hook.data : null;
    const stats = retentionStats(data?.posts ?? [], durations);
    const ctx = data ? contextBlock(data) : { text: "", hasData: false };

    workDir = await makeTmpDir(id);
    let file: string;
    let caption = input.caption ?? "";
    let reelLine = "Unposted video uploaded for a pre-post check.";
    let post: HookPost | undefined;

    if (input.source === "upload") {
      const upload = input.uploadId ? await readUpload(row.workspaceId, input.uploadId) : null;
      if (!upload || upload.received < upload.size) {
        throw new Error("The uploaded video isn't there any more. Upload it again.");
      }
      file = upload.path;
      reelLine = `Unposted video "${upload.fileName}" uploaded for a pre-post check.`;
    } else {
      await patchResult(id, { stage: "downloading" });
      const account = await getWorkspaceInstagramAccount(row.workspaceId, input.instagramAccountId ?? null);
      if (!account) throw new Error("Connect an Instagram account first.");
      const media = await getMediaById(decryptToken(account.accessToken), row.mediaId!);
      if (!media.media_url) {
        throw new Error("Instagram didn't give us a video link for this post (it may be a copyrighted-audio reel). Upload the file instead.");
      }
      if (media.media_type !== "VIDEO") {
        throw new Error("That post isn't a video, so there's nothing to watch.");
      }
      file = path.join(workDir, "video.mp4");
      await downloadToFile(media.media_url, file);
      caption = media.caption ?? caption;
      post = data?.posts.find((p) => p.id === row.mediaId);
      reelLine = post ? describePost(post) : "Posted reel (no numbers from Instagram).";
    }

    const out = await analyzeVideoFile({
      file,
      workDir,
      caption,
      reelLine,
      contextText: ctx.text,
      stats,
      profile,
      persona,
      posted: input.source !== "upload",
      actual: post
        ? {
            hold3s: post.hold3s,
            avgWatchPct: null, // filled below once we know the length
          }
        : undefined,
      onStage: (stage) => patchResult(id, { stage }),
    });

    if (post && out.expectedRetention?.actual && out.result.durationSec && post.avgWatchTimeMs !== null) {
      out.expectedRetention.actual.avgWatchPct = Math.min(
        1,
        post.avgWatchTimeMs / 1000 / out.result.durationSec
      );
    }

    const current = await prisma.coachAnalysis.findUnique({ where: { id }, select: { result: true } });
    const startedAt = (current?.result as AnalyzeResult | null)?.startedAt;
    await prisma.coachAnalysis.update({
      where: { id },
      data: {
        result: JSON.parse(JSON.stringify({ ...out.result, startedAt })) as Prisma.InputJsonValue,
        ...(out.expectedRetention
          ? { expectedRetention: JSON.parse(JSON.stringify(out.expectedRetention)) as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (err) {
    console.error("[Coach] analyze failed:", err instanceof Error ? err.message : err);
    await patchResult(id, { status: "error", error: friendly(err) }).catch(() => undefined);
  } finally {
    if (workDir) await removeDir(workDir);
  }
}
