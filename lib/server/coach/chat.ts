/**
 * Coach chat: a light conversation with the selected persona. The model gets
 * the creator's profile, top/bottom posts, retention distribution and recent
 * saved analyses as context. Pasting a link to one of his own reels attaches
 * an "Analyze" offer to the reply.
 */

import { generateText, type ModelMessage } from "ai";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getHookData, type HookPost } from "@/lib/server/hook-coach";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";
import { resolvePersona } from "@/lib/server/coach/personas";
import { listAnalyses } from "@/lib/server/coach/analyses";
import {
  knownDurations,
  retentionStats,
  statsText,
} from "@/lib/server/coach/retention";
import {
  coachModel,
  contextBlock,
  describePost,
  systemPrompt,
} from "@/lib/server/coach/prompting";
import type {
  AnalyzeResult,
  ChatMessageData,
  FixResult,
  SavedAnalysis,
  WriteResult,
} from "@/lib/coach/types";

const HISTORY_LIMIT = 20;
const MAX_MESSAGE_CHARS = 4000;

const REEL_URL_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i;

function shortcodeOf(url: string | null | undefined): string | null {
  return url?.match(REEL_URL_RE)?.[1] ?? null;
}

function summariseAnalysis(a: SavedAnalysis, posts: HookPost[]): string {
  const when = a.createdAt.slice(0, 10);
  const post = a.mediaId ? posts.find((p) => p.id === a.mediaId) : undefined;
  const which = post ? `reel "${post.hook || "(no caption)"}"` : "an uploaded video";
  if (a.kind === "analyze") {
    const r = a.result as AnalyzeResult;
    if (r?.status !== "done") return "";
    return `- ${when} ANALYZED ${which}: ${r.score ?? "?"}/5, "${r.verdict ?? ""}". ${r.summary ?? ""}`;
  }
  if (a.kind === "fix") {
    const r = a.result as FixResult;
    return `- ${when} FIXED ${which}: ${r?.diagnosis ?? ""} New hook: "${r?.stories?.[0]?.beats?.[0]?.text ?? ""}"`;
  }
  const r = a.result as WriteResult;
  const idea = (a.input as { idea?: string } | null)?.idea ?? "";
  return `- ${when} WROTE stories for idea "${idea.slice(0, 120)}": ${(r?.stories ?? []).map((s) => `"${s.title}"`).join(", ")}`;
}

function toMessage(m: {
  id: string;
  role: string;
  content: string;
  data: unknown;
  createdAt: Date;
}): ChatMessageData {
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    data: (m.data as ChatMessageData["data"]) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function getChatMessages(chatId: string): Promise<ChatMessageData[]> {
  const rows = await prisma.coachMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map(toMessage);
}

/**
 * Save the user's message, ask the persona, save and return the reply.
 * Throws with a friendly message on failure (the user message stays saved).
 */
export async function sendChatMessage(args: {
  workspaceId: string;
  chatId: string;
  personaId?: string | null;
  message: string;
  instagramAccountId?: string;
}): Promise<{ user: ChatMessageData; reply: ChatMessageData }> {
  const model = coachModel();
  if (!model) throw new Error("The Coach isn't set up yet: ANTHROPIC_API_KEY is missing on the server.");

  const text = args.message.trim().slice(0, MAX_MESSAGE_CHARS);
  const user = await prisma.coachMessage.create({
    data: { chatId: args.chatId, role: "user", content: text },
  });

  const [hook, profile, persona, analyses, durations, history] = await Promise.all([
    getHookData(args.workspaceId, args.instagramAccountId),
    getHookCoachProfile(args.workspaceId),
    resolvePersona(args.workspaceId, args.personaId),
    listAnalyses(args.workspaceId, { take: 12 }),
    knownDurations(args.workspaceId).catch(() => new Map<string, number>()),
    prisma.coachMessage.findMany({
      where: { chatId: args.chatId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    }),
  ]);
  const posts = hook.status === "ok" ? hook.data.posts : [];

  // A pasted reel link: is it one of his?
  let linkNote = "";
  let data: ChatMessageData["data"] = null;
  const code = shortcodeOf(text);
  if (code) {
    const post = posts.find((p) => shortcodeOf(p.permalink) === code);
    if (post) {
      const saved = analyses.find((a) => a.kind === "analyze" && a.mediaId === post.id);
      data = { analyzeMediaId: post.id, ...(saved ? { analysisId: saved.id } : {}) };
      linkNote = `\n\nHE PASTED A LINK TO HIS OWN REEL: ${describePost(post)}\nCaption: "${(post.caption ?? "").slice(0, 400)}"\n${
        saved
          ? "A saved full analysis of it exists (see recent analyses); refer to it."
          : 'The app shows him an "Analyze this reel" button under your reply that watches the full video. Give a quick read from the numbers and caption, and tell him to tap Analyze for the second-by-second breakdown.'
      }`;
    } else {
      linkNote =
        "\n\nHE PASTED AN INSTAGRAM LINK that is NOT one of his last 30 posts. You can't open links; tell him you can only analyze his own recent reels (or he can upload the video in the Reels tab), and answer from what he says about it.";
    }
  }

  const context = [
    hook.status === "ok" ? contextBlock(hook.data).text : "No Instagram data available right now.",
    "",
    statsText(retentionStats(posts, durations)),
    "",
    "RECENT COACH WORK (saved):",
    ...analyses.map((a) => summariseAnalysis(a, posts)).filter(Boolean).slice(0, 8),
  ].join("\n");

  const system = `${systemPrompt(profile, persona, { json: false })}

You are chatting with him in the DM Desk Coach. Answer like a sharp friend who knows his numbers: short paragraphs, bullet lists when listing, concrete lines he can say. Use his numbers when they help. Plain text only (simple "-" bullets and **bold** are fine, no tables, no headings). Keep it under ~250 words unless he asks for a full script.

HIS DATA:
${context}${linkNote}`;

  const ordered = history.reverse();
  while (ordered.length > 1 && ordered[0].role === "assistant") ordered.shift();
  const messages: ModelMessage[] = ordered
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  const { text: reply } = await generateText({
    model,
    system,
    messages,
    maxOutputTokens: 3000,
    abortSignal: AbortSignal.timeout(100_000),
    maxRetries: 1,
  });

  const saved = await prisma.coachMessage.create({
    data: {
      chatId: args.chatId,
      role: "assistant",
      content: reply.trim() || "Sorry, I lost my train of thought. Ask me again?",
      ...(data ? { data: data as Prisma.InputJsonValue } : {}),
    },
  });
  await prisma.coachChat.update({
    where: { id: args.chatId },
    data: { updatedAt: new Date(), ...(args.personaId ? { personaId: persona.id || null } : {}) },
  });
  return { user: toMessage(user), reply: toMessage(saved) };
}

export function chatTitle(message: string): string {
  const t = message.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "New chat";
}
