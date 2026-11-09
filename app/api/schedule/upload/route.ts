import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { NextRequest, NextResponse } from "next/server";
import {
  fileExtension,
  isAllowedExtension,
  MAX_VIDEO_BYTES,
  UPLOAD_CHUNK_BYTES,
} from "@/lib/scheduling/rules";
import {
  absolutePath,
  cleanStaleUploads,
  ensureDirs,
  faststartRemux,
  fileSize,
  isSafeId,
  probeProblem,
  probeVideo,
  readUploadMeta,
  removeUpload,
  uploadPaths,
  writeUploadMeta,
  type UploadMeta,
} from "@/lib/scheduling/storage";
import { requireScheduleAccess } from "@/lib/scheduling/access";

/**
 * Chunked, resumable video upload. The body is the raw bytes of one chunk
 * (≤ 16 MB, so it passes the Cloudflare tunnel's 100 MB request cap) and is
 * streamed straight to disk — never buffered in memory.
 *
 * Headers: x-file-name, x-file-size (total bytes), x-upload-offset,
 * x-upload-id (omit on the first chunk). A chunk whose offset doesn't match
 * what's on disk gets 409 + { received } so the client resumes from there.
 * On the last chunk the file is checked with ffprobe and remuxed (faststart).
 */

const MAX_CHUNK = UPLOAD_CHUNK_BYTES + 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;

  const total = Number(request.headers.get("x-file-size"));
  const offset = Number(request.headers.get("x-upload-offset") ?? "0");
  let uploadId = request.headers.get("x-upload-id");
  if (!Number.isInteger(total) || total <= 0)
    return json({ error: "Missing file size." }, 400);
  if (total > MAX_VIDEO_BYTES)
    return json({ error: "Videos can be 300 MB at most." }, 413);
  if (!Number.isInteger(offset) || offset < 0)
    return json({ error: "Bad offset." }, 400);
  if (!request.body) return json({ error: "Empty body." }, 400);

  await ensureDirs();
  let meta: UploadMeta | null;

  if (!uploadId) {
    const ext = fileExtension(
      decodeURIComponent(request.headers.get("x-file-name") ?? "")
    );
    if (!isAllowedExtension(ext))
      return json({ error: "Pick an MP4 or MOV video." }, 415);
    if (offset !== 0) return json({ error: "First chunk must start at 0." }, 400);
    void cleanStaleUploads();
    uploadId = randomUUID();
    meta = {
      uploadId,
      workspaceId: access.workspaceId,
      userId: access.userId,
      ext: ext as UploadMeta["ext"],
      total,
      createdAt: new Date().toISOString(),
    };
    await writeUploadMeta(meta);
  } else {
    if (!isSafeId(uploadId)) return json({ error: "Bad upload id." }, 400);
    meta = await readUploadMeta(uploadId);
    if (!meta || meta.workspaceId !== access.workspaceId)
      return json({ error: "Upload not found. Pick the video again." }, 404);
    if (meta.total !== total) return json({ error: "File size changed." }, 400);
  }

  if (meta.finalPath) {
    return json({ uploadId, done: true, received: total, probe: meta.probe });
  }

  const paths = uploadPaths(uploadId, meta.ext);
  const received = await fileSize(paths.data);
  if (offset !== received) {
    return json({ uploadId, received, error: "Offset mismatch" }, 409);
  }

  // Stream the chunk to disk, refusing anything past the declared size.
  let written = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (written > MAX_CHUNK || received + written > total) {
        cb(new Error("Chunk too large"));
        return;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeWebReadableStream),
      limiter,
      createWriteStream(absolutePath(paths.data), { flags: "a" })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload interrupted";
    const now = await fileSize(paths.data);
    return json({ uploadId, received: now, error: message }, 400);
  }

  const nowReceived = received + written;
  if (nowReceived < total) {
    return json({ uploadId, done: false, received: nowReceived });
  }

  // Complete: check it's a real Reel-able video, then faststart-remux.
  try {
    const abs = absolutePath(paths.data);
    const probe = await probeVideo(abs);
    const problem = probeProblem(probe, total);
    if (problem) {
      await removeUpload(uploadId);
      return json({ error: problem }, 422);
    }
    const finalRel = `${paths.data.replace(/\.part\.\w+$/, "")}.mp4`;
    const remuxed = await faststartRemux(abs, absolutePath(finalRel));
    const finalPath = remuxed ? finalRel : paths.data;
    meta = { ...meta, probe, finalPath };
    await writeUploadMeta(meta);
    return json({ uploadId, done: true, received: total, probe });
  } catch (err) {
    await removeUpload(uploadId);
    const message =
      err instanceof Error ? err.message : "Could not read that video.";
    return json({ error: `Could not read that video. ${message}` }, 422);
  }
}
