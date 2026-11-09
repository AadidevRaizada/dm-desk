import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireScheduleAccess } from "@/lib/scheduling/access";
import { HOOK_POSITION_DEFAULT, MAX_VARIANTS } from "@/lib/strategy/config";
import { parseSourceRef, resolveSource, SourceError } from "@/lib/strategy/sources";
import { plannedDuration, previewJpeg } from "@/lib/strategy/variants";

const schema = z.object({
  source: z.unknown(),
  hookPosition: z.enum(["top", "middle"]).default(HOOK_POSITION_DEFAULT),
  variants: z
    .array(
      z.object({
        hook: z.string().max(300).nullable(),
        trimStartSec: z.number().min(0).max(600).default(0),
      })
    )
    .min(1)
    .max(MAX_VARIANTS),
});

/**
 * POST /api/strategy/preview: first frame of each variant with its hook
 * burned in (small JPEG data URLs). Also downloads/caches a reel source.
 */
export async function POST(request: NextRequest) {
  const access = await requireScheduleAccess();
  if ("error" in access) return access.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const source = parsed.success ? parseSourceRef(parsed.data.source) : null;
  if (!parsed.success || !source) {
    return NextResponse.json({ error: "Pick a video and at least one hook." }, { status: 400 });
  }
  try {
    const resolved = await resolveSource(access.workspaceId, source);
    const previews: Array<{ image: string | null; error: string | null }> = [];
    for (const v of parsed.data.variants) {
      try {
        plannedDuration({ hook: v.hook, trimStartSec: v.trimStartSec }, resolved.durationSec);
        const jpg = await previewJpeg(resolved.absPath, {
          hook: v.hook,
          trimStartSec: v.trimStartSec,
          hookPosition: parsed.data.hookPosition,
        });
        previews.push({ image: `data:image/jpeg;base64,${jpg.toString("base64")}`, error: null });
      } catch (err) {
        previews.push({ image: null, error: err instanceof Error ? err.message : "Preview failed." });
      }
    }
    return NextResponse.json(
      { durationSec: resolved.durationSec, previews },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof SourceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[Strategy] preview failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't make the previews." }, { status: 500 });
  }
}
