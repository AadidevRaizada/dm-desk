import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { createUpload, uploadExt } from "@/lib/server/coach/media";
import { MAX_UPLOAD_BYTES } from "@/lib/coach/types";

/**
 * POST /api/coach/uploads {fileName, size, type} -> {id}
 * Starts a private, chunked upload (PUT /api/coach/uploads/[id]?offset=N).
 * Chunks keep each request under the Cloudflare tunnel's 100 MB body limit.
 */
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";
  const type = typeof body?.type === "string" ? body.type : "";
  const size = Number(body?.size);
  const ext = uploadExt(fileName, type);
  if (!ext) return fail("Upload an .mp4 or .mov video.", 400);
  if (!Number.isFinite(size) || size <= 0) return fail("That file looks empty.", 400);
  if (size > MAX_UPLOAD_BYTES) return fail("Videos up to 200 MB.", 413);
  const id = randomUUID().replace(/-/g, "");
  try {
    await createUpload(context.workspaceId, id, fileName, ext, size);
  } catch (err) {
    console.error("[Coach] upload create failed:", err);
    return fail("Couldn't start the upload.", 500);
  }
  return NextResponse.json({ success: true, id });
}
