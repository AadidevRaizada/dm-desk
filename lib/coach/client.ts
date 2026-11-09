"use client";

import { UPLOAD_CHUNK_BYTES } from "@/lib/coach/types";

/** fetch JSON from a Coach API route; throws an Error with a friendly message. */
export async function coachApi<T = Record<string, unknown>>(
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error("You seem to be offline. Try again.");
  }
  let json: { success?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    // non-JSON (e.g. a gateway timeout page)
  }
  if (!res.ok || json.success === false) {
    throw new Error(
      json.error ??
        (res.status === 504 || res.status === 524
          ? "That took too long. Try again."
          : "Something went wrong. Try again.")
    );
  }
  return json as T;
}

/** Chunked private upload; resolves to the upload id. */
export async function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void
): Promise<string> {
  const { id } = await coachApi<{ id: string }>("/api/coach/uploads", {
    body: { fileName: file.name, size: file.size, type: file.type },
  });
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(`/api/coach/uploads/${id}?offset=${offset}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        const json = (await res.json().catch(() => ({}))) as {
          received?: number;
          error?: string;
        };
        if (!res.ok || typeof json.received !== "number") {
          throw new Error(json.error ?? "Upload failed");
        }
        offset = json.received;
        break;
      } catch (err) {
        if (++attempt >= 3) {
          throw err instanceof Error ? err : new Error("Upload failed");
        }
      }
    }
    onProgress(offset / file.size);
  }
  return id;
}
