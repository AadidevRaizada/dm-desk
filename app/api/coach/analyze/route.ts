import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getHookData } from "@/lib/server/hook-coach";
import { resolvePersona } from "@/lib/server/coach/personas";
import { analysisSelect, toSaved } from "@/lib/server/coach/analyses";
import { startAnalyzeJob } from "@/lib/server/coach/analyze";
import { isSafeId, readUpload } from "@/lib/server/coach/media";
import { coachModel, NO_KEY_MESSAGE } from "@/lib/server/coach/prompting";
import type { AnalyzeInput, AnalyzeResult } from "@/lib/coach/types";

/**
 * POST /api/coach/analyze  {mediaId} | {uploadId}  (+ personaId, instagramAccountId)
 * Creates a pending CoachAnalysis (kind "analyze") and starts the background
 * job. Returns the row at once; the UI polls /api/coach/analyses/[id].
 */
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  if (!coachModel()) return fail(NO_KEY_MESSAGE, 503);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("Invalid JSON body.", 400);
  const mediaId = typeof body.mediaId === "string" ? body.mediaId.trim() : "";
  const uploadId = typeof body.uploadId === "string" ? body.uploadId.trim() : "";
  const instagramAccountId =
    typeof body.instagramAccountId === "string" ? body.instagramAccountId : undefined;
  const persona = await resolvePersona(
    context.workspaceId,
    typeof body.personaId === "string" ? body.personaId : null
  );

  let input: AnalyzeInput & { instagramAccountId?: string };
  if (uploadId) {
    if (!isSafeId(uploadId)) return fail("Bad upload id.", 400);
    const upload = await readUpload(context.workspaceId, uploadId);
    if (!upload) return fail("Upload not found. Upload the video again.", 404);
    if (upload.received < upload.size) return fail("The upload isn't finished yet.", 409);
    input = { source: "upload", uploadId, fileName: upload.fileName };
  } else if (mediaId) {
    const hook = await getHookData(context.workspaceId, instagramAccountId);
    const post = hook.status === "ok" ? hook.data.posts.find((p) => p.id === mediaId) : undefined;
    if (hook.status === "ok" && !post) return fail("That post isn't in your last 30 posts.", 404);
    if (post && !post.isReel && post.mediaType !== "VIDEO") {
      return fail("That post isn't a video, so there's nothing to watch.", 400);
    }
    input = {
      source: "reel",
      mediaId,
      caption: post?.caption ?? "",
      permalink: post?.permalink ?? null,
      thumbnailUrl: post?.thumbnailUrl ?? null,
      instagramAccountId,
    };
  } else {
    return fail("Send {mediaId} or {uploadId}.", 400);
  }

  const result: AnalyzeResult = {
    status: "pending",
    stage: "queued",
    startedAt: new Date().toISOString(),
  };
  const row = await prisma.coachAnalysis.create({
    data: {
      workspaceId: context.workspaceId,
      kind: "analyze",
      mediaId: mediaId || null,
      personaId: persona.id || null,
      input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    },
    select: analysisSelect,
  });
  startAnalyzeJob(row.id);
  return NextResponse.json({ success: true, analysis: toSaved(row) });
}
