"use client";

import { useCallback, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import ScheduleForm from "@/components/schedule-form";
import ScheduleList from "@/components/schedule-list";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScheduleData } from "@/lib/scheduling/queries";

export default function ScheduleBoard({
  initial,
  canEdit,
}: {
  initial: ScheduleData;
  canEdit: boolean;
}) {
  const [data, setData] = useState(initial);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/schedule", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as ScheduleData);
  }, []);

  const noAccount = data.accounts.length === 0;

  return (
    <div className="space-y-6">
      {data.reconnectNeeded ? (
        <div
          role="alert"
          className="hr2 flex flex-col gap-3 border-[2.5px] border-hd-accent bg-paper2 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <WarningCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-hd-accent" />
            <div>
              <p className="font-display text-xl leading-tight">
                Reconnect Instagram to allow publishing
              </p>
              <p className="text-sm text-muted-foreground">
                Instagram said DM Desk can&apos;t post for you yet. Sign in again and
                allow &quot;publish content&quot;, then tap Retry.
              </p>
            </div>
          </div>
          <a
            href="/api/instagram/connect"
            className={cn(buttonVariants({ variant: "hero" }), "clicky h-11 shrink-0 px-4 text-base")}
          >
            Reconnect
          </a>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {noAccount ? (
          <div className="hr1 border-[2.5px] border-ink bg-card p-5">
            <p className="font-display text-2xl">Connect Instagram first</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reels go out from your connected account.
            </p>
            <a
              href="/api/instagram/connect"
              className={cn(buttonVariants({ variant: "hero" }), "clicky mt-4 h-11 w-full text-base")}
            >
              Connect Instagram
            </a>
          </div>
        ) : canEdit ? (
          <ScheduleForm
            accounts={data.accounts}
            topPostTimestamps={data.topPostTimestamps}
            onScheduled={refresh}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            You can see the schedule but not change it in this workspace.
          </p>
        )}
        <ScheduleList posts={data.posts} canEdit={canEdit} onChange={refresh} />
      </div>
    </div>
  );
}
