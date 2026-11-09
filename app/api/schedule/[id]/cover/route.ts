import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { absolutePath } from "@/lib/scheduling/storage";

/** The cover frame thumbnail shown in the schedule list (signed-in only). */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const { id } = await ctx.params;

  const post = await prisma.scheduledPost.findFirst({
    where: { id, workspaceId: access.workspaceId },
    select: { coverPath: true },
  });
  if (!post?.coverPath) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await readFile(absolutePath(post.coverPath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
