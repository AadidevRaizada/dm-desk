import { Suspense } from "react";
import { redirect } from "next/navigation";
import ScheduleBoard from "@/components/schedule-board";
import { HdPageHead } from "@/components/handdrawn/hd-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { getScheduleData } from "@/lib/scheduling/queries";
import {
  canManageCampaigns,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * Schedule a reel: upload a video, pick a time, the worker publishes it to
 * Instagram (lib/scheduling/publisher.ts). On top: the posting strategy
 * engine (lib/strategy/*): this week's plan, suggested moves, hook tests and
 * remixes. Below: tests, the queue and the "new" flows.
 */
export default function SchedulePage() {
  return (
    <div className="space-y-6">
      <HdPageHead
        area="hooks"
        title="Post a reel"
        line="Your week, what to post next, and hook tests that pick their own winner."
      />
      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleRegion />
      </Suspense>
    </div>
  );
}

async function ScheduleRegion() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  const data = await getScheduleData(context.workspaceId);
  return <ScheduleBoard initial={data} canEdit={canManageCampaigns(context)} />;
}

function ScheduleSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
      <div className="hr1 space-y-4 border-[2.5px] border-ink bg-card p-5">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="hr2 space-y-3 border-[2.5px] border-ink bg-card p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
