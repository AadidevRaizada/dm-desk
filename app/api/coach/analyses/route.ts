import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { listAnalyses } from "@/lib/server/coach/analyses";
import type { CoachKind } from "@/lib/coach/types";

const KINDS: CoachKind[] = ["fix", "write", "analyze"];

/** GET /api/coach/analyses?kind=fix&mediaId=... — saved Coach results, newest first. */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind = KINDS.find((k) => k === kindParam);
  const mediaId = request.nextUrl.searchParams.get("mediaId") ?? undefined;
  const data = await listAnalyses(context.workspaceId, { kind, mediaId });
  return NextResponse.json(
    { success: true, data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
