import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { getScheduleData } from "@/lib/scheduling/queries";
import { captionProblem } from "@/lib/scheduling/rules";
import {
  absolutePath,
  coverRelPath,
  extractCover,
  moveIntoPlace,
  readUploadMeta,
  removeUpload,
  SCHEDULED_DIR,
} from "@/lib/scheduling/storage";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const data = await getScheduleData(access.workspaceId);
  return NextResponse.json(data, { headers: noStore });
}

const createSchema = z.object({
  uploadId: z.string().min(8).max(64),
  instagramAccountId: z.string().min(1).optional().nullable(),
  caption: z.string().max(10_000).default(""),
  scheduledAt: z.iso.datetime({ offset: true }),
  shareToFeed: z.boolean().default(true),
  thumbOffsetMs: z.number().int().min(0).max(15 * 60_000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const problem = captionProblem(input.caption);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const scheduledAt = new Date(input.scheduledAt);
  // A minute of slack so "now" from a slow phone still counts.
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json(
      { error: "Pick a time in the future." },
      { status: 400 }
    );
  }

  const meta = await readUploadMeta(input.uploadId);
  if (!meta || meta.workspaceId !== access.workspaceId || !meta.finalPath) {
    return NextResponse.json(
      { error: "The video isn't uploaded yet. Pick it again." },
      { status: 400 }
    );
  }

  const account = await prisma.instagramAccount.findFirst({
    where: {
      workspaceId: access.workspaceId,
      ...(input.instagramAccountId ? { id: input.instagramAccountId } : {}),
    },
    orderBy: { connectedAt: "asc" },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json(
      { error: "Connect an Instagram account first." },
      { status: 400 }
    );
  }

  const id = meta.uploadId;
  const videoPath = `${SCHEDULED_DIR}/${id}.mp4`;
  const duration = meta.probe?.durationSec ?? 0;
  const offset = Math.min(
    input.thumbOffsetMs ?? 0,
    Math.max(0, Math.floor(duration * 1000) - 100)
  );

  await moveIntoPlace(meta.finalPath, videoPath);
  const coverRel = coverRelPath(id, offset);
  const hasCover = await extractCover(
    absolutePath(videoPath),
    offset,
    absolutePath(coverRel)
  );
  await removeUpload(id);

  const post = await prisma.scheduledPost.create({
    data: {
      id,
      workspaceId: access.workspaceId,
      instagramAccountId: account.id,
      caption: input.caption,
      videoPath,
      // The offset rides in the cover's file name, so keep it even if the frame grab failed.
      coverPath: hasCover || offset > 0 ? coverRel : null,
      shareToFeed: input.shareToFeed,
      scheduledAt,
      status: "SCHEDULED",
    },
    select: { id: true, scheduledAt: true },
  });

  return NextResponse.json(
    { id: post.id, scheduledAt: post.scheduledAt.toISOString() },
    { status: 201, headers: noStore }
  );
}
