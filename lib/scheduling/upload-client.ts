import { UPLOAD_CHUNK_BYTES } from "@/lib/scheduling/rules";

export interface UploadResult {
  uploadId: string;
  probe?: { durationSec: number; width: number | null; height: number | null };
}

/**
 * Browser side of /api/schedule/upload: sends the file in 16 MB chunks,
 * resumes from the server's byte count after a 409 or a dropped connection.
 */
export async function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  let uploadId: string | null = null;
  let offset = 0;
  let failures = 0;

  while (true) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
      "x-file-size": String(file.size),
      "x-upload-offset": String(offset),
    };
    if (uploadId) headers["x-upload-id"] = uploadId;

    let res: Response;
    try {
      res = await fetch("/api/schedule/upload", {
        method: "POST",
        headers,
        body: file.slice(offset, end),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (++failures > 4) throw new Error("Upload keeps dropping. Check your connection.");
      await new Promise((r) => setTimeout(r, 1500 * failures));
      continue;
    }

    const body = (await res.json().catch(() => ({}))) as {
      uploadId?: string;
      received?: number;
      done?: boolean;
      error?: string;
      probe?: UploadResult["probe"];
    };

    if (res.ok) {
      failures = 0;
      uploadId = body.uploadId ?? uploadId;
      offset = body.received ?? end;
      onProgress(offset / file.size);
      if (body.done && uploadId) return { uploadId, probe: body.probe };
      continue;
    }

    // Offset mismatch or a half-written chunk: resume where the server is.
    if ((res.status === 409 || res.status === 400) && typeof body.received === "number" && body.uploadId) {
      uploadId = body.uploadId;
      offset = body.received;
      if (++failures > 4) throw new Error(body.error ?? "Upload failed.");
      continue;
    }
    if (res.status >= 500 && ++failures <= 4) {
      await new Promise((r) => setTimeout(r, 1500 * failures));
      continue;
    }
    throw new Error(body.error ?? `Upload failed (${res.status}).`);
  }
}
