import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { absolutePath, isSafeId, verifyMediaToken } from "@/lib/scheduling/storage";

/**
 * Fallback video source for Meta (video_url) when the resumable upload isn't
 * accepted. Public, but only with a short-lived HMAC signature minted by the
 * publisher, and only while the post is publishing.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const exp = request.nextUrl.searchParams.get("exp");
  const sig = request.nextUrl.searchParams.get("sig");
  if (!isSafeId(id) || !verifyMediaToken(id, exp, sig)) {
    return new NextResponse(null, { status: 403 });
  }

  const post = await prisma.scheduledPost.findUnique({
    where: { id },
    select: { videoPath: true, status: true },
  });
  if (!post || post.status !== "PUBLISHING") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const abs = absolutePath(post.videoPath);
    const { size } = await stat(abs);
    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
