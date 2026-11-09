/**
 * Coach-written hooks for tests and re-edits: N on-screen opening hooks in
 * his voice (persona + style profile + his top/bottom posts), plus a fresh
 * caption for reposts. Server only.
 */

import { generateText } from "ai";
import { getHookData } from "@/lib/server/hook-coach";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";
import { resolvePersona } from "@/lib/server/coach/personas";
import {
  coachModel,
  contextBlock,
  describePost,
  GARBLED,
  MAX_HOOK_WORDS,
  NO_KEY_MESSAGE,
  parseJsonObject,
  str,
  systemPrompt,
} from "@/lib/server/coach/prompting";
import { MAX_HOOK_CHARS, MAX_VARIANTS } from "@/lib/strategy/config";
import { captionProblem } from "@/lib/scheduling/rules";

export interface HookIdea {
  text: string;
  /** Short note on the angle ("curiosity gap", "callout"...). */
  angle: string;
}

export interface HookResult {
  hooks: HookIdea[];
  /** Fresh caption (reposts, or when asked). */
  caption: string | null;
}

export class CoachUnavailableError extends Error {}

export async function generateHooks(args: {
  workspaceId: string;
  personaId?: string | null;
  count: number;
  mode: "test" | "repost";
  /** His reel this is built on, when there is one. */
  mediaId?: string | null;
  /** What the video is about (uploads have no caption). */
  idea?: string | null;
  /** Hooks to avoid repeating (e.g. the original one). */
  avoid?: string[];
}): Promise<HookResult> {
  const model = coachModel();
  if (!model) throw new CoachUnavailableError(NO_KEY_MESSAGE);
  const count = Math.min(Math.max(1, args.count), MAX_VARIANTS);

  const [profile, persona, hook] = await Promise.all([
    getHookCoachProfile(args.workspaceId),
    resolvePersona(args.workspaceId, args.personaId),
    getHookData(args.workspaceId),
  ]);
  const data = hook.status === "ok" ? hook.data : null;
  const reel = args.mediaId && data ? data.posts.find((p) => p.id === args.mediaId) : null;
  const context = data ? contextBlock(data) : null;

  const subject = reel
    ? `THE REEL (already posted): ${describePost(reel)}\nIts full caption:\n${reel.caption ?? "(none)"}`
    : `THE VIDEO (not posted yet). What it's about: ${args.idea?.trim() || "(not described; write hooks that would fit a reel in his niche)"}`;

  const task =
    args.mode === "repost"
      ? `He is re-editing this reel to post it again to people who haven't seen it. Write ${count} NEW on-screen hooks for the first 3 seconds (different angle from the original opening line) and ONE new caption: a fresh first line (not the old one), then the body, then his CTA. Keep hashtags to 5 or fewer.`
      : `He is A/B testing the first 3 seconds of this video as trial reels. Write ${count} on-screen hooks that are genuinely DIFFERENT angles (e.g. curiosity gap, bold claim, callout of the viewer, result first, mistake/warning), so the test teaches him something.`;

  const prompt = [
    context?.hasData ? context.text : "",
    "",
    subject,
    "",
    task,
    `Each hook: ${MAX_HOOK_WORDS} words or fewer, max ${MAX_HOOK_CHARS} characters, burned on screen as text, no emoji, no hashtags, no quotes around it.`,
    args.avoid?.length ? `Do not reuse these: ${args.avoid.map((a) => `"${a}"`).join(", ")}` : "",
    "",
    `Reply with JSON: {"hooks": [{"text": "string", "angle": "2-4 words"}], "caption": ${args.mode === "repost" ? '"string"' : "null"}}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const { text } = await generateText({
    model,
    system: systemPrompt(profile, persona),
    prompt,
    maxOutputTokens: 2_000,
    abortSignal: AbortSignal.timeout(90_000),
    maxRetries: 1,
  });

  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.hooks)) throw new Error(GARBLED);
  const seen = new Set<string>();
  const hooks: HookIdea[] = [];
  for (const h of parsed.hooks) {
    const t = typeof h === "string" ? h.trim() : str((h as Record<string, unknown>)?.text);
    const clean = t.replace(/^["“]|["”]$/g, "").trim().slice(0, MAX_HOOK_CHARS);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    hooks.push({
      text: clean,
      angle: typeof h === "object" && h ? str((h as Record<string, unknown>).angle) : "",
    });
    if (hooks.length >= count) break;
  }
  if (hooks.length === 0) throw new Error(GARBLED);
  let caption = str(parsed.caption) || null;
  if (caption && captionProblem(caption)) caption = caption.slice(0, 2000);
  return { hooks, caption };
}
