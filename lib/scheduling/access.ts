import { NextResponse } from "next/server";
import { canManageCampaigns, getCurrentWorkspaceContext } from "@/lib/workspace-access";

/** Signed-in member who may manage content in the active workspace. */
export async function requireScheduleAccess(): Promise<
  { workspaceId: string; userId: string } | { error: NextResponse }
> {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageCampaigns(context)) {
    return {
      error: NextResponse.json(
        { error: "You don't have permission to schedule posts here." },
        { status: 403 }
      ),
    };
  }
  return { workspaceId: context.workspaceId, userId: context.userId };
}
