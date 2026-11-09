import { NextRequest, NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/scheduling/publisher";

/**
 * Backup trigger for scheduled reels (the worker loop is the main one).
 * scripts/cron.mjs calls this every minute; claims make overlap safe.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const data = await publishDuePosts();
  return NextResponse.json(
    { success: true, data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = handle;
export const POST = handle;
