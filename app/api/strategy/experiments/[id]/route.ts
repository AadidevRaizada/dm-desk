import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { getExperimentView } from "@/lib/strategy/data";
import {
  cancelExperiment,
  markShared,
  repostWinner,
  StrategyError,
} from "@/lib/strategy/experiments";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("shared") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("repost_winner"),
    scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  }),
]);

export async function GET(_request: NextRequest, ctx: Ctx) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const { id } = await ctx.params;
  const view = await getExperimentView(access.workspaceId, id);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

/** "Done, I shared it" / repost the winner to followers / cancel the test. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    switch (parsed.data.action) {
      case "shared":
        await markShared(access.workspaceId, id);
        return NextResponse.json({ ok: true });
      case "cancel":
        await cancelExperiment(access.workspaceId, id);
        return NextResponse.json({ ok: true });
      case "repost_winner":
        return NextResponse.json(await repostWinner(access.workspaceId, id, parsed.data.scheduledAt));
    }
  } catch (err) {
    if (err instanceof StrategyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[Strategy] action failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "That didn't work. Try again." }, { status: 500 });
  }
}
