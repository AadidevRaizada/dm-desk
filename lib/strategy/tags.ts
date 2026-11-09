/**
 * Format / topic tags for his reels (research note R8), derived once by the
 * model from caption + hook and cached in StrategyTag. Runs in the
 * background; nothing waits on it. Server only.
 */

import { generateText } from "ai";
import { prisma } from "@/lib/db/client";
import { coachModel, parseJsonObject, str } from "@/lib/server/coach/prompting";
import { FORMATS } from "@/lib/strategy/config";
import type { ReelStat } from "@/lib/strategy/candidates";

const running = new Set<string>();

export async function loadTags(
  workspaceId: string
): Promise<Map<string, { format: string; topic: string }>> {
  const rows = await prisma.strategyTag.findMany({
    where: { workspaceId },
    select: { mediaId: true, format: true, topic: true },
  });
  return new Map(rows.map((r) => [r.mediaId, { format: r.format, topic: r.topic }]));
}

export function normaliseFormat(value: unknown): string {
  const v = str(value).toLowerCase().replace(/[^a-z-]/g, "");
  return (FORMATS as readonly string[]).includes(v) ? v : "other";
}

/** Tag reels that have no tag yet (fire and forget; one run per workspace). */
export function tagReelsInBackground(workspaceId: string, reels: ReelStat[], known: Set<string>) {
  const untagged = reels.filter((r) => !known.has(r.id) && (r.caption || r.hook));
  if (untagged.length === 0 || running.has(workspaceId) || !coachModel()) return;
  running.add(workspaceId);
  void tagReels(workspaceId, untagged)
    .catch((err) =>
      console.error("[Strategy] Tagging failed:", err instanceof Error ? err.message : err)
    )
    .finally(() => running.delete(workspaceId));
}

export async function tagReels(workspaceId: string, reels: ReelStat[]): Promise<number> {
  const model = coachModel();
  if (!model || reels.length === 0) return 0;
  const batch = reels.slice(0, 30);
  const list = batch
    .map(
      (r) =>
        `${r.id}: hook "${r.hook}" | caption: ${(r.caption ?? "").replace(/\s+/g, " ").slice(0, 240)}`
    )
    .join("\n");
  const { text } = await generateText({
    model,
    system:
      "You label short-form videos for a creator analytics tool. Reply with ONLY a JSON object, no markdown.",
    prompt: `Label each reel with one FORMAT from this list: ${FORMATS.join(", ")}; and a TOPIC of 2-4 lowercase words (what it is about, consistent wording across reels on the same subject).\n\nREELS:\n${list}\n\nReply: {"tags": [{"id": "reel id", "format": "one of the list", "topic": "2-4 words"}]}`,
    maxOutputTokens: 3_000,
    abortSignal: AbortSignal.timeout(90_000),
    maxRetries: 1,
  });
  const parsed = parseJsonObject(text);
  const tags = Array.isArray(parsed?.tags) ? parsed.tags : [];
  const ids = new Set(batch.map((r) => r.id));
  let saved = 0;
  for (const t of tags) {
    const v = (t ?? {}) as Record<string, unknown>;
    const mediaId = str(v.id);
    if (!ids.has(mediaId)) continue;
    const format = normaliseFormat(v.format);
    const topic = str(v.topic).toLowerCase().slice(0, 60) || "general";
    await prisma.strategyTag.upsert({
      where: { workspaceId_mediaId: { workspaceId, mediaId } },
      create: { workspaceId, mediaId, format, topic },
      update: { format, topic },
    });
    saved += 1;
  }
  return saved;
}
