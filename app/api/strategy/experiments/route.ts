import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { HOOK_POSITION_DEFAULT, MAX_VARIANTS, MIN_VARIANTS, TEST_VARIABLES } from "@/lib/strategy/config";
import { listExperiments } from "@/lib/strategy/data";
import { createHookTest, createRepost, StrategyError } from "@/lib/strategy/experiments";
import { parseSourceRef, SourceError } from "@/lib/strategy/sources";

const noStore = { "Cache-Control": "no-store" };

const variantSchema = z.object({
  hook: z.string().max(300).nullable(),
  trimStartSec: z.number().min(0).max(600).optional(),
  maxDurationSec: z.number().min(3).max(900).nullable().optional(),
  coverOffsetMs: z.number().int().min(0).max(15 * 60_000).optional(),
  caption: z.string().max(10_000).nullable().optional(),
});

const testSchema = z.object({
  kind: z.literal("ab_test"),
  source: z.unknown(),
  variable: z.enum(TEST_VARIABLES).default("hook"),
  name: z.string().max(120).nullable().optional(),
  caption: z.string().max(10_000).default(""),
  shareToFeed: z.boolean().default(true),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  hookPosition: z.enum(["top", "middle"]).default(HOOK_POSITION_DEFAULT),
  variants: z.array(variantSchema).min(MIN_VARIANTS).max(MAX_VARIANTS),
});

const repostSchema = z.object({
  kind: z.literal("repost"),
  mediaId: z.string().regex(/^\d{5,40}$/),
  hook: z.string().min(1).max(300),
  caption: z.string().min(1).max(10_000),
  trimStartSec: z.number().min(0).max(30).optional(),
  coverOffsetMs: z.number().int().min(0).max(15 * 60_000).optional(),
  trial: z.boolean().default(true),
  shareToFeed: z.boolean().default(true),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  hookPosition: z.enum(["top", "middle"]).default(HOOK_POSITION_DEFAULT),
});

export async function GET() {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  return NextResponse.json({ experiments: await listExperiments(access.workspaceId) }, { headers: noStore });
}

/** POST /api/strategy/experiments: start a hook test or a remix & repost. */
export async function POST(request: NextRequest) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const body = await request.json().catch(() => null);
  const parsed = z.discriminatedUnion("kind", [testSchema, repostSchema]).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    if (parsed.data.kind === "ab_test") {
      const source = parseSourceRef(parsed.data.source);
      if (!source) return NextResponse.json({ error: "Pick a video first." }, { status: 400 });
      const result = await createHookTest({ workspaceId: access.workspaceId, ...parsed.data, source });
      return NextResponse.json(result, { status: 201, headers: noStore });
    }
    const result = await createRepost({ workspaceId: access.workspaceId, ...parsed.data });
    return NextResponse.json(result, { status: 201, headers: noStore });
  } catch (err) {
    if (err instanceof StrategyError || err instanceof SourceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[Strategy] create failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't start that. Try again." }, { status: 500 });
  }
}
