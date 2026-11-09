import { NextRequest, NextResponse } from "next/server";
import { APICallError, generateText } from "ai";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getHookData, type HookPost } from "@/lib/server/hook-coach";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";
import { storyDuration, type StoryLength } from "@/lib/hook-coach-story";
import { resolvePersona } from "@/lib/server/coach/personas";
import { analysisSelect, toSaved } from "@/lib/server/coach/analyses";
import {
  cleanRetention,
  knownDurations,
  retentionStats,
  RETENTION_RULES,
  RETENTION_SHAPE,
  statsText,
  watchPct,
} from "@/lib/server/coach/retention";
import {
  cleanStory,
  coachModel,
  contextBlock,
  describePost,
  diagnose,
  GARBLED,
  MAX_HOOK_WORDS,
  NO_KEY_MESSAGE,
  parseJsonObject,
  str,
  STORY_SHAPE,
  systemPrompt,
} from "@/lib/server/coach/prompting";
import type {
  FixProblem,
  StoryWithRetention,
} from "@/lib/coach/types";

/**
 * POST /api/hook-coach — "Fix this reel" and "Write 3 stories".
 * Every result is saved as a CoachAnalysis (kind "fix" | "write") with an
 * expected-retention range grounded in the creator's own numbers, and the
 * saved row is returned so the UI can show it again without regenerating.
 */

// A cold Hook Coach snapshot means ~30 insight calls before the model call.
export const maxDuration = 120;

const MODEL_TIMEOUT_MS = 110_000;
const MAX_IDEA_CHARS = 1_000;

type CoachRequest =
  | {
      mode: "fix";
      mediaId: string;
      instagramAccountId?: string;
      personaId?: string;
    }
  | {
      mode: "write";
      idea: string;
      length: StoryLength;
      instagramAccountId?: string;
      personaId?: string;
    };

function parseRequest(body: unknown): CoachRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const instagramAccountId =
    typeof b.instagramAccountId === "string" ? b.instagramAccountId : undefined;
  const personaId = typeof b.personaId === "string" ? b.personaId : undefined;
  if (b.mode === "fix" && typeof b.mediaId === "string" && b.mediaId.trim()) {
    return {
      mode: "fix",
      mediaId: b.mediaId.trim(),
      instagramAccountId,
      personaId,
    };
  }
  if (b.mode === "write" && typeof b.idea === "string" && b.idea.trim()) {
    return {
      mode: "write",
      idea: b.idea.trim().slice(0, MAX_IDEA_CHARS),
      length: b.length === "long" ? "long" : "short",
      instagramAccountId,
      personaId,
    };
  }
  return null;
}

const STORY_WITH_RETENTION = `${STORY_SHAPE}, "expectedRetention": ${RETENTION_SHAPE}}`;

function lengthRules(length: StoryLength) {
  return length === "long"
    ? "LONG reel, 45-90 seconds total: hook, content, rehook, content, rehook, content, payoff (at least 2 rehooks; each rehook is one line, ~2-4s)."
    : "SHORT reel, 15-30 seconds total: hook, content, payoff (content may be 1-2 beats, no rehooks).";
}

function fixPrompt(
  post: HookPost,
  signal: string,
  context: string,
  stats: string
) {
  return `${context}

${stats}

REEL TO FIX:
${describePost(post)}
Caption start: "${(post.caption ?? "").slice(0, 500)}"

RULE-BASED DIAGNOSIS: ${signal}

Diagnosis rules: high skip rate = hook problem; low skip but low avg watch time = content sag, people lost before the payoff; low shares/saves = weak payoff.
1. Write a 2-3 sentence plain-language "diagnosis" that follows the signal above and cites his numbers.
2. Rewrite this same reel as a full story that fixes the weak part. Choose short (15-30s) or long (45-90s, at least 2 rehooks) based on what the topic needs; for a content sag, use rehooks. The first beat is the hook (${MAX_HOOK_WORDS} words max); the last beat is the payoff including the CTA.
3. ${RETENTION_RULES} This reel actually got ${post.hold3s === null ? "no reported" : `${Math.round(post.hold3s * 100)}%`} 3-second hold; estimate what the rewrite would get.

JSON shape:
{"diagnosis": "string", "story": ${STORY_WITH_RETENTION}}`;
}

function writePrompt(
  idea: string,
  length: StoryLength,
  context: string,
  stats: string
) {
  return `${context}

${stats}

NEW IDEA FROM THE CREATOR:
"""${idea}"""

Write 3 genuinely different story scripts for this idea: a different hook angle and a different reference creator's technique for each.
${lengthRules(length)}
The first beat is the hook (${MAX_HOOK_WORDS} words max). The last beat is the payoff and includes the CTA.
${RETENTION_RULES}

JSON shape:
{"stories": [${STORY_WITH_RETENTION}]}`;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return jsonError("Unauthorized", 401);

  const model = coachModel();
  if (!model) return jsonError(NO_KEY_MESSAGE, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const req = parseRequest(body);
  if (!req) {
    return jsonError(
      'Send {mode:"fix", mediaId} or {mode:"write", idea, length}.',
      400
    );
  }

  const [result, profile, persona, durations] = await Promise.all([
    getHookData(context.workspaceId, req.instagramAccountId),
    getHookCoachProfile(context.workspaceId).catch(() => null),
    resolvePersona(context.workspaceId, req.personaId),
    knownDurations(context.workspaceId).catch(() => new Map<string, number>()),
  ]);
  if (result.status === "no_account") {
    return jsonError("Connect an Instagram account first.", 400);
  }
  if (result.status === "error") return jsonError(result.message, 502);
  if (!profile) return jsonError("Couldn't load your style profile.", 500);

  const data = result.data;
  const ctx = contextBlock(data);
  if (!ctx.hasData) {
    return jsonError(
      "Instagram hasn't shared enough numbers for your posts yet, so there's nothing to learn your style from.",
      422
    );
  }
  const stats = retentionStats(data.posts, durations);
  const statsBlock = statsText(stats);

  let prompt: string;
  let problem: FixProblem | undefined;
  let post: HookPost | undefined;
  if (req.mode === "fix") {
    post = data.posts.find((p) => p.id === req.mediaId);
    if (!post) return jsonError("That post isn't in your last 30 posts.", 404);
    const d = diagnose(post, data);
    problem = d.problem;
    prompt = fixPrompt(post, d.signal, ctx.text, statsBlock);
  } else {
    prompt = writePrompt(req.idea, req.length, ctx.text, statsBlock);
  }

  const fallbackCta = profile.cta.trim();

  try {
    const { text, finishReason } = await generateText({
      model,
      system: systemPrompt(profile, persona),
      prompt,
      maxOutputTokens: req.mode === "write" ? 12_000 : 6_000,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      maxRetries: 1,
    });

    const parsed = parseJsonObject(text);
    if (!parsed) {
      console.error(
        `[Coach] Unparseable reply (finish=${finishReason}, ${text.length} chars): ${text.slice(0, 300)}`
      );
      return jsonError(GARBLED, 502);
    }

    const withRetention = (raw: unknown): StoryWithRetention | null => {
      const story = cleanStory(raw, fallbackCta);
      if (!story) return null;
      const r = raw as Record<string, unknown>;
      const expectedRetention = cleanRetention(r.expectedRetention, stats, {
        storySeconds: storyDuration(story),
        actual: post
          ? { hold3s: post.hold3s, avgWatchPct: watchPct(post, durations) }
          : undefined,
      });
      return expectedRetention ? { ...story, expectedRetention } : story;
    };

    let saveData: {
      kind: "fix" | "write";
      mediaId: string | null;
      input: Prisma.InputJsonValue;
      result: Prisma.InputJsonValue;
      expectedRetention?: Prisma.InputJsonValue;
    };

    if (req.mode === "fix") {
      // Accept {story}, {stories:[...]} or a bare story object.
      const candidate =
        parsed.story ??
        (Array.isArray(parsed.stories) ? parsed.stories[0] : undefined) ??
        parsed;
      const story = withRetention(candidate);
      if (!story) return jsonError(GARBLED, 502);
      const fixResult = {
        diagnosis: str(parsed.diagnosis) || undefined,
        problem,
        stories: [story],
      };
      saveData = {
        kind: "fix",
        mediaId: req.mediaId,
        input: { mediaId: req.mediaId, hook: post?.hook ?? "" },
        result: JSON.parse(JSON.stringify(fixResult)),
        expectedRetention: story.expectedRetention
          ? JSON.parse(JSON.stringify(story.expectedRetention))
          : undefined,
      };
    } else {
      const rawStories: unknown[] = Array.isArray(parsed.stories)
        ? parsed.stories
        : parsed.beats
          ? [parsed]
          : [];
      const stories = rawStories
        .map(withRetention)
        .filter((s): s is StoryWithRetention => s !== null)
        .slice(0, 3);
      if (stories.length === 0) return jsonError(GARBLED, 502);
      saveData = {
        kind: "write",
        mediaId: null,
        input: { idea: req.idea, length: req.length },
        result: JSON.parse(JSON.stringify({ stories })),
        expectedRetention: JSON.parse(
          JSON.stringify(stories.map((s) => s.expectedRetention ?? null))
        ),
      };
    }

    const row = await prisma.coachAnalysis.create({
      data: {
        workspaceId: context.workspaceId,
        personaId: persona.id || null,
        ...saveData,
      },
      select: analysisSelect,
    });
    return NextResponse.json({ success: true, analysis: toSaved(row) });
  } catch (err) {
    console.error(
      "[Coach] Model call failed:",
      APICallError.isInstance(err)
        ? `HTTP ${err.statusCode ?? "unknown"}`
        : err instanceof Error
          ? err.message
          : err
    );
    return jsonError("The coach couldn't answer right now. Try again.", 502);
  }
}
