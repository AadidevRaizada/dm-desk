import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { appendUpload, isSafeId, readUpload } from "@/lib/server/coach/media";
import { UPLOAD_CHUNK_BYTES } from "@/lib/coach/types";

type Ctx = { params: Promise<{ id: string }> };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

/** PUT ?offset=N with a raw chunk body. Returns bytes received so far. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  if (!isSafeId(id)) return fail("Bad id", 400);
  const offset = Number(request.nextUrl.searchParams.get("offset"));
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isInteger(offset) || offset < 0) return fail("Bad offset", 400);
  if (length > UPLOAD_CHUNK_BYTES * 2) return fail("Chunk too large", 413);
  if (!request.body) return fail("Empty chunk", 400);
  try {
    const received = await appendUpload(context.workspaceId, id, offset, request.body);
    return NextResponse.json({ success: true, received });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return fail(message, /not found/i.test(message) ? 404 : 409);
  }
}

/**
 * GET streams the uploaded video back to the signed-in workspace only
 * (with Range support so the <video> player can seek). Never public.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  if (!isSafeId(id)) return fail("Bad id", 400);
  const upload = await readUpload(context.workspaceId, id);
  if (!upload) return fail("Not found", 404);
  const { size } = await fs.stat(upload.path);
  const type = upload.ext === ".mov" ? "video/quicktime" : "video/mp4";
  const base = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (!range[1] && range[2]) {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(upload.path, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(upload.path)) as ReadableStream;
  return new NextResponse(stream, {
    headers: { ...base, "Content-Length": String(size) },
  });
}
