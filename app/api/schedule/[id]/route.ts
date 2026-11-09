import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { captionProblem } from "@/lib/scheduling/rules";
import { absolutePath, removeFile } from "@/lib/scheduling/storage";
import { existsSync } from "node:fs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.union([
  z.object({
    action: z.literal("retry"),
  }),
  z.object({
    action: z.literal("update"),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    caption: z.string().max(10_000).optional(),
    shareToFeed: z.boolean().optional(),
    trialStrategy: z.enum(["MANUAL", "SS_PERFORMANCE"]).nullable().optional(),
  }),
]);

async function findOwned(id: string, workspaceId: string) {
  return prisma.scheduledPost.findFirst({ where: { id, workspaceId } });
}

/** Edit time/caption of a scheduled post, or retry a failed one. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const post = await findOwned(id, access.workspaceId);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.action === "retry") {
    if (post.status !== "FAILED") {
      return NextResponse.json(
        { error: "Only failed posts can be retried." },
        { status: 409 }
      );
    }
    if (!existsSync(absolutePath(post.videoPath))) {
      return NextResponse.json(
        { error: "The video file is gone. Delete this and upload it again." },
        { status: 409 }
      );
    }
    // Guarded so a retry can't race the publisher.
    const updated = await prisma.scheduledPost.updateMany({
      where: { id, status: "FAILED" },
      data: {
        status: "SCHEDULED",
        scheduledAt: new Date(),
        attempts: 0,
        error: null,
        containerId: null,
      },
    });
    return NextResponse.json({ ok: updated.count === 1 });
  }

  const { scheduledAt, caption, shareToFeed, trialStrategy } = parsed.data;
  if (caption !== undefined) {
    const problem = captionProblem(caption);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }
  if (scheduledAt && new Date(scheduledAt).getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Pick a time in the future." }, { status: 400 });
  }
  const updated = await prisma.scheduledPost.updateMany({
    // Failed posts can be moved too; that also re-queues them.
    where: { id, status: { in: ["SCHEDULED", "FAILED"] } },
    data: {
      ...(scheduledAt
        ? {
            scheduledAt: new Date(scheduledAt),
            status: "SCHEDULED",
            ...(post.status === "FAILED"
              ? { attempts: 0, error: null, containerId: null }
              : {}),
          }
        : {}),
      ...(caption !== undefined ? { caption } : {}),
      ...(shareToFeed !== undefined ? { shareToFeed } : {}),
      ...(trialStrategy !== undefined ? { trialStrategy } : {}),
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json(
      { error: "This post is publishing or already out." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

/** Cancel a scheduled post (or clear a failed / published one from the list). */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const { id } = await ctx.params;

  const post = await findOwned(id, access.workspaceId);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const deleted = await prisma.scheduledPost.deleteMany({
    where: { id, status: { in: ["SCHEDULED", "FAILED", "PUBLISHED"] } },
  });
  if (deleted.count !== 1) {
    return NextResponse.json(
      { error: "It's publishing right now. Try again in a minute." },
      { status: 409 }
    );
  }
  await removeFile(post.videoPath);
  await removeFile(post.coverPath);
  return NextResponse.json({ ok: true });
}
