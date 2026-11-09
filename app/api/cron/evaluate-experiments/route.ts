import { NextRequest, NextResponse } from "next/server";
import { evaluateExperiments } from "@/lib/strategy/evaluate";

/**
 * Backup trigger for the strategy evaluator (the worker runs it every 15
 * minutes). scripts/cron.mjs calls this every 15 minutes too; every write is
 * idempotent, so overlap is safe.
 */
async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const data = await evaluateExperiments();
  return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
