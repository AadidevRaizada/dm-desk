import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { mockPrisma, tmpVideo } = vi.hoisted(() => {
  return {
    mockPrisma: {
      scheduledPost: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
    tmpVideo: { path: "" },
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (s: string) => `plain-${s}` }));
vi.mock("@/lib/scheduling/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/scheduling/storage")>();
  return {
    ...real,
    absolutePath: () => tmpVideo.path,
    removeFile: vi.fn(),
    signedVideoUrl: (id: string) => `https://example.test/api/schedule/media/${id}?exp=1&sig=x`,
  };
});

import {
  claimPost,
  classifyError,
  publishDuePosts,
  RETRY_DELAY_MS,
} from "@/lib/scheduling/publisher";
import { MetaApiError, PermissionError, TokenExpiredError } from "@/lib/meta/client";
import { RECONNECT_PREFIX, captionProblem, countHashtags } from "@/lib/scheduling/rules";
import { bestLocalHour, suggestSlot } from "@/lib/scheduling/suggest";
import { signMediaToken, thumbOffsetFromCover, verifyMediaToken } from "@/lib/scheduling/storage";

const NOW = new Date("2026-11-09T10:00:00.000Z");
const V = "v26.0";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post_123456",
    caption: "Hello #reels",
    videoPath: "storage/scheduled/post_123456.mp4",
    coverPath: "storage/scheduled/post_123456.t2500.jpg",
    shareToFeed: true,
    attempts: 0,
    containerId: null,
    instagramAccount: { instagramId: "1789", accessToken: "enc", username: "me" },
    ...overrides,
  };
}

type Route = (url: string, init?: RequestInit) => unknown;
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(routes: Route) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const out = routes(String(url), init);
      if (out instanceof Error) throw out;
      const { status = 200, body } = out as { status?: number; body: unknown };
      return new Response(JSON.stringify(body), { status });
    })
  );
}

const opts = {
  now: () => NOW,
  sleep: async () => {},
  pollIntervalMs: 1,
  pollTimeoutMs: 60_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  const dir = mkdtempSync(path.join(tmpdir(), "sched-"));
  tmpVideo.path = path.join(dir, "v.mp4");
  writeFileSync(tmpVideo.path, Buffer.alloc(2048, 1));
  mockPrisma.scheduledPost.findMany.mockImplementation(async (args: { where: { status: string } }) =>
    args.where.status === "SCHEDULED" ? [{ id: "post_123456" }] : []
  );
  mockPrisma.scheduledPost.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.scheduledPost.update.mockResolvedValue({});
  mockPrisma.scheduledPost.findUnique.mockResolvedValue(post());
});

afterEach(() => vi.unstubAllGlobals());

function lastUpdateData() {
  const c = mockPrisma.scheduledPost.update.mock.calls;
  return c[c.length - 1][0].data;
}

describe("claimPost", () => {
  it("claims with a guarded updateMany and only succeeds once", async () => {
    mockPrisma.scheduledPost.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.scheduledPost.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await claimPost("a", NOW)).toBe(true);
    expect(await claimPost("a", NOW)).toBe(false);
    expect(mockPrisma.scheduledPost.updateMany).toHaveBeenCalledWith({
      where: { id: "a", status: "SCHEDULED", scheduledAt: { lte: NOW } },
      data: { status: "PUBLISHING" },
    });
  });

  it("does nothing when another caller already claimed the post", async () => {
    mockPrisma.scheduledPost.updateMany.mockResolvedValue({ count: 0 });
    mockFetch(() => ({ body: {} }));
    const r = await publishDuePosts(opts);
    expect(r.claimed).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("publishDuePosts — happy path (resumable)", () => {
  it("creates a container, uploads bytes, polls, publishes, saves permalink", async () => {
    let polls = 0;
    mockFetch((url, init) => {
      if (url.includes("/content_publishing_limit"))
        return { body: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } };
      if (url.endsWith("/1789/media") && init?.method === "POST") return { body: { id: "C1" } };
      if (url.startsWith("https://rupload.facebook.com/")) return { body: { success: true } };
      if (url.includes("/C1?")) return { body: { id: "C1", status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" } };
      if (url.endsWith("/1789/media_publish")) return { body: { id: "M1" } };
      if (url.includes("/M1?")) return { body: { id: "M1", permalink: "https://www.instagram.com/reel/abc/" } };
      return { status: 404, body: { error: { message: "unexpected " + url, code: 100 } } };
    });

    const r = await publishDuePosts(opts);
    expect(r).toMatchObject({ claimed: 1, published: 1, failed: 0, rescheduled: 0 });

    const create = calls.find((c) => c.url.endsWith("/1789/media"))!;
    expect(create.url).toBe(`https://graph.instagram.com/${V}/1789/media`);
    expect((create.init!.headers as Record<string, string>).Authorization).toBe("Bearer plain-enc");
    expect(JSON.parse(create.init!.body as string)).toEqual({
      media_type: "REELS",
      caption: "Hello #reels",
      share_to_feed: true,
      upload_type: "resumable",
      thumb_offset: 2500,
    });

    const upload = calls.find((c) => c.url.startsWith("https://rupload"))!;
    expect(upload.url).toBe(`https://rupload.facebook.com/ig-api-upload/${V}/C1`);
    const h = upload.init!.headers as Record<string, string>;
    expect(h.Authorization).toBe("OAuth plain-enc");
    expect(h.offset).toBe("0");
    expect(h.file_size).toBe("2048");
    expect((upload.init!.body as Buffer).length).toBe(2048);

    expect(calls.filter((c) => c.url.includes("/C1?fields=id%2Cstatus_code%2Cstatus"))).toHaveLength(2);

    const pub = calls.find((c) => c.url.endsWith("/media_publish"))!;
    expect(pub.url).toBe(`https://graph.instagram.com/${V}/1789/media_publish`);
    expect(JSON.parse(pub.init!.body as string)).toEqual({ creation_id: "C1" });

    expect(lastUpdateData()).toMatchObject({
      status: "PUBLISHED",
      mediaId: "M1",
      permalink: "https://www.instagram.com/reel/abc/",
      publishedAt: NOW,
      error: null,
    });
  });

  it("falls back to a signed video_url container when the resumable upload is refused", async () => {
    let containers = 0;
    mockFetch((url, init) => {
      if (url.includes("/content_publishing_limit")) return { body: { data: [] } };
      if (url.endsWith("/1789/media") && init?.method === "POST") return { body: { id: `C${++containers}` } };
      if (url.startsWith("https://rupload")) return { status: 400, body: { debug_info: { retriable: false, type: "ProcessingFailedError", message: "nope" } } };
      if (url.includes("/C2?")) return { body: { id: "C2", status_code: "FINISHED" } };
      if (url.endsWith("/media_publish")) return { body: { id: "M2" } };
      if (url.includes("/M2?")) return { body: { permalink: "https://www.instagram.com/reel/x/" } };
      return { status: 500, body: { error: { message: "?", code: 2 } } };
    });
    const r = await publishDuePosts({ ...opts, uploadMode: "auto" });
    expect(r.published).toBe(1);
    const creates = calls.filter((c) => c.url.endsWith("/1789/media"));
    expect(creates).toHaveLength(2);
    const second = JSON.parse(creates[1].init!.body as string);
    expect(second.video_url).toMatch(/^https:\/\/example\.test\/api\/schedule\/media\/post_123456/);
    expect(second.upload_type).toBeUndefined();
  });
});

describe("publishDuePosts — trial reels", () => {
  it("sends trial_params with the graduation strategy", async () => {
    mockPrisma.scheduledPost.findUnique.mockResolvedValue(post({ trialStrategy: "SS_PERFORMANCE" }));
    mockFetch((url, init) => {
      if (url.includes("/content_publishing_limit"))
        return { body: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } };
      if (url.endsWith("/1789/media") && init?.method === "POST") return { body: { id: "C1" } };
      if (url.startsWith("https://rupload.facebook.com/")) return { body: { success: true } };
      if (url.includes("/C1?")) return { body: { id: "C1", status_code: "FINISHED" } };
      if (url.endsWith("/1789/media_publish")) return { body: { id: "M1" } };
      if (url.includes("/M1?")) return { body: { id: "M1", permalink: "https://www.instagram.com/reel/t/" } };
      return { status: 404, body: { error: { message: "unexpected " + url, code: 100 } } };
    });
    await publishDuePosts(opts);
    const create = calls.find((c) => c.url.endsWith("/1789/media"))!;
    expect(JSON.parse(create.init!.body as string).trial_params).toEqual({
      graduation_strategy: "SS_PERFORMANCE",
    });
  });
});

describe("publishDuePosts — failures", () => {
  it("reschedules +10 min on a transient error and counts the attempt", async () => {
    mockFetch(() => new TypeError("fetch failed"));
    const r = await publishDuePosts({ ...opts, uploadMode: "resumable" });
    expect(r.rescheduled).toBe(1);
    const data = lastUpdateData();
    expect(data.status).toBe("SCHEDULED");
    expect(data.attempts).toBe(1);
    expect(data.scheduledAt.getTime()).toBe(NOW.getTime() + RETRY_DELAY_MS);
  });

  it("fails after the third transient attempt", async () => {
    mockPrisma.scheduledPost.findUnique.mockResolvedValue(post({ attempts: 2 }));
    mockFetch(() => new TypeError("fetch failed"));
    const r = await publishDuePosts({ ...opts, uploadMode: "resumable" });
    expect(r.failed).toBe(1);
    expect(lastUpdateData()).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("marks permission errors as needing a reconnect", async () => {
    mockFetch((url) => {
      if (url.includes("/content_publishing_limit")) return { body: { data: [] } };
      return {
        status: 403,
        body: { error: { message: "(#10) Application does not have permission for this action", code: 10 } },
      };
    });
    const r = await publishDuePosts(opts);
    expect(r.failed).toBe(1);
    const data = lastUpdateData();
    expect(data.status).toBe("FAILED");
    expect(data.error.startsWith(RECONNECT_PREFIX)).toBe(true);
  });

  it("fails without retry when Instagram can't process the video", async () => {
    mockFetch((url, init) => {
      if (url.includes("/content_publishing_limit")) return { body: { data: [] } };
      if (url.endsWith("/media") && init?.method === "POST") return { body: { id: "C1" } };
      if (url.startsWith("https://rupload")) return { body: { success: true } };
      if (url.includes("/C1?")) return { body: { id: "C1", status_code: "ERROR", status: "Error: 2207026" } };
      return { status: 500, body: {} };
    });
    const r = await publishDuePosts(opts);
    expect(r.failed).toBe(1);
    expect(lastUpdateData()).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(lastUpdateData().error).toContain("couldn't process");
    expect(calls.some((c) => c.url.endsWith("/media_publish"))).toBe(false);
  });

  it("gives up when processing outlasts the poll window", async () => {
    let t = NOW.getTime();
    mockFetch((url, init) => {
      if (url.includes("/content_publishing_limit")) return { body: { data: [] } };
      if (url.endsWith("/media") && init?.method === "POST") return { body: { id: "C1" } };
      if (url.startsWith("https://rupload")) return { body: { success: true } };
      if (url.includes("/C1?")) return { body: { id: "C1", status_code: "IN_PROGRESS" } };
      return { status: 500, body: {} };
    });
    const r = await publishDuePosts({
      ...opts,
      now: () => new Date(t),
      sleep: async () => {
        t += 120_000;
      },
      pollTimeoutMs: 600_000,
    });
    expect(r.failed).toBe(1);
    expect(lastUpdateData().error).toContain("10 minutes");
  });

  it("waits without spending an attempt when the 24h quota is used up", async () => {
    mockFetch((url) => {
      if (url.includes("/content_publishing_limit"))
        return { body: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } };
      return { status: 500, body: {} };
    });
    const r = await publishDuePosts(opts);
    expect(r.rescheduled).toBe(1);
    const data = lastUpdateData();
    expect(data.status).toBe("SCHEDULED");
    expect(data.attempts).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe("classifyError", () => {
  it("sorts errors", () => {
    expect(classifyError(new TokenExpiredError("x"))).toBe("reconnect");
    expect(classifyError(new PermissionError("Application does not have permission"))).toBe("reconnect");
    expect(classifyError(new MetaApiError(2, undefined, undefined, "Service temporarily unavailable"))).toBe("transient");
    expect(classifyError(new MetaApiError(100, undefined, undefined, "Invalid parameter"))).toBe("fatal");
    expect(classifyError(new TypeError("fetch failed"))).toBe("transient");
  });
});

describe("rules + suggestions + storage helpers", () => {
  it("validates captions", () => {
    expect(countHashtags("#a #b c#d #e_1")).toBe(3);
    expect(captionProblem("x".repeat(2201))).toMatch(/2200/);
    expect(captionProblem(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "))).toMatch(/30/);
    expect(captionProblem("fine #ok")).toBeNull();
  });

  it("suggests the most common hour of top posts, else tomorrow 7 pm", () => {
    const at = (h: number, d = 1) => new Date(2026, 10, d, h, 15).toISOString();
    expect(bestLocalHour([at(18), at(18, 2), at(9)])).toBe(18);
    const now = new Date(2026, 10, 9, 20, 0);
    const s = suggestSlot([at(18), at(18, 2)], now);
    expect(s.reason).toBe("top-posts");
    expect(s.at.getDate()).toBe(10);
    expect(s.at.getHours()).toBe(18);
    const d = suggestSlot([], now);
    expect(d.reason).toBe("default");
    expect(d.at.getDate()).toBe(10);
    expect(d.at.getHours()).toBe(19);
  });

  it("keeps the cover offset in the file name and signs media links", () => {
    expect(thumbOffsetFromCover("storage/scheduled/x.t1500.jpg")).toBe(1500);
    expect(thumbOffsetFromCover(null)).toBeNull();
    process.env.NEXTAUTH_SECRET ??= "test-secret-test-secret";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signMediaToken("post_123456", exp);
    expect(verifyMediaToken("post_123456", String(exp), sig)).toBe(true);
    expect(verifyMediaToken("post_other00", String(exp), sig)).toBe(false);
    expect(verifyMediaToken("post_123456", String(exp - 120), sig)).toBe(false);
  });
});
