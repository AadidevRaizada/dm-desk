import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { MAX_VARIANTS } from "@/lib/strategy/config";
import { CoachUnavailableError, generateHooks } from "@/lib/strategy/hooks";

const schema = z.object({
  mode: z.enum(["test", "repost"]).default("test"),
  count: z.number().int().min(1).max(MAX_VARIANTS).default(MAX_VARIANTS),
  mediaId: z.string().regex(/^\d{5,40}$/).nullable().optional(),
  idea: z.string().max(1000).nullable().optional(),
  personaId: z.string().max(64).nullable().optional(),
  avoid: z.array(z.string().max(200)).max(10).optional(),
});

/** POST /api/strategy/hooks: Coach writes hooks (and a repost caption). */
export async function POST(request: NextRequest) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    const result = await generateHooks({ workspaceId: access.workspaceId, ...parsed.data });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach couldn't write hooks.";
    const status = err instanceof CoachUnavailableError ? 503 : 502;
    if (!(err instanceof CoachUnavailableError)) console.error("[Strategy] hooks failed:", message);
    return NextResponse.json({ error: status === 503 ? message : "The coach couldn't write hooks. Try again or type your own." }, { status });
  }
}
