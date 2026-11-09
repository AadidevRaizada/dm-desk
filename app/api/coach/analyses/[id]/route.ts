import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getAnalysis } from "@/lib/server/coach/analyses";

const headers = { "Cache-Control": "no-store" };
type Ctx = { params: Promise<{ id: string }> };

/** GET: one saved result (the UI polls this while an analyze job runs). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers });
  }
  const { id } = await params;
  const data = await getAnalysis(context.workspaceId, id);
  if (!data) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404, headers });
  }
  return NextResponse.json({ success: true, data }, { headers });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers });
  }
  const { id } = await params;
  const { count } = await prisma.coachAnalysis.deleteMany({
    where: { id, workspaceId: context.workspaceId },
  });
  return NextResponse.json({ success: count > 0 }, { status: count > 0 ? 200 : 404, headers });
}
