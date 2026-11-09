import { NextResponse } from "next/server";
import { getStrategyData } from "@/lib/strategy/data";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/** GET /api/strategy: week plan, suggested moves, experiments, his reels. */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await getStrategyData(context.workspaceId);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[Strategy] load failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't load your plan. Try again." }, { status: 500 });
  }
}
