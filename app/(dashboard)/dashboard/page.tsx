import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  FilmSlate,
  Megaphone,
  PaperPlaneTilt,
  PlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import AccountUrlFilter from "@/components/account-url-filter";
import CountUp from "@/components/count-up";
import StatusBadge from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getDashboardInsights, getDashboardSummary } from "@/lib/server/stats";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { CritterArt } from "@/components/handdrawn/critter-art";
import { HdPageHead } from "@/components/handdrawn/hd-bits";

/**
 * Dashboard Home Page (Server Component)
 *
 * Renders in two independently-streaming regions:
 *
 *  1. Summary — greeting, hero metrics, and the secondary metric strip. Cheap
 *     reads (counts), cached 120s, so this paints almost immediately.
 *  2. Insights — 7-day chart, top keywords, recent activity. Heavier reads,
 *     cached 5 min; streams in after the summary.
 *
 * Each region is its own Suspense boundary, so the browser paints the summary
 * while the insights region is still being computed on the server. Client
 * islands: the account `<select>`, the count-up numbers, and the lazily-loaded
 * chart (recharts bundle deferred until the region streams).
 */

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<SummarySkeleton />}>
        <SummaryRegion searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<InsightsSkeleton />}>
        <InsightsRegion searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid gap-4  lg:grid-cols-3">
        <div className="lg:col-span-2 hr1 border-[2.5px] border-ink bg-card p-6">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-10 w-24" />
          <Skeleton className="mt-3 h-4 w-48" />
        </div>
        <div className="hr1 border-[2.5px] border-ink bg-card p-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-10 w-24" />
          <Skeleton className="mt-3 h-2 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 hr3 border-[2.5px] border-ink bg-card px-5 py-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 ">
      <div className="lg:col-span-3 hr1 border-[2.5px] border-ink bg-card p-6">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-44 w-full" />
      </div>
      <div className="lg:col-span-1 hr1 border-[2.5px] border-ink bg-card p-6">
        <Skeleton className="h-4 w-28" />
        <div className="mt-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
      <div className="lg:col-span-2 hr1 border-[2.5px] border-ink bg-card p-6">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

const DashboardChart = dynamic(() => import("@/components/dashboard-chart"), {
  loading: () => (
    <div className="hr1 border-[2.5px] border-ink bg-card p-6">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-4 h-44 w-full" />
    </div>
  ),
});

async function SummaryRegion({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard">["searchParams"];
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const selectedAccountId =
    typeof params.instagramAccountId === "string"
      ? params.instagramAccountId
      : "all";

  const stats = await getDashboardSummary(
    context.workspaceId,
    context.userId,
    selectedAccountId === "all" ? null : selectedAccountId,
  );

  // const connectedCount = stats.instagramAccounts.length;
  const campaignPct = Math.min(
    Math.round(
      (stats.activeAutomations / Math.max(stats.totalAutomations, 1)) * 100,
    ),
    100,
  );

  return (
    <>
      {/* Greeting */}
      <HdPageHead
        area="home"
        title={<>Hi, {stats.userName ?? "there"}!</>}
        line="Here is what your DMs did."
        actions={
          <>
            <Link
              href="/schedule"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "clicky h-11 px-4 text-base",
              )}
            >
              <FilmSlate className="size-5" weight="bold" /> Schedule a reel
            </Link>
            {stats.instagramAccounts.length > 1 ? (
              <AccountUrlFilter
                accounts={stats.instagramAccounts}
                value={selectedAccountId}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>New automation</CardTitle>
          </CardHeader>
          <CardContent className="h-full justify-end">
            <div className="flex items-end gap-3">
              <CritterArt area="campaigns" className="w-20 shrink-0" />
              <p className="text-sm text-muted-foreground">
                Someone comments a word, they get your DM.
              </p>
            </div>
            <Link
              href="/campaigns/new"
              className={cn(
                buttonVariants({ variant: "hero", size: "lg" }),
                "clicky mt-auto h-12 w-full text-xl",
              )}
            >
              <PlusIcon className="size-5" weight="bold" /> Make one
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PaperPlaneTilt weight="fill" className="size-4" />
              DMs sent this week
            </CardTitle>
            <CardAction>
              <Link
                href="/logs"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                See log
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="font-display text-6xl leading-none text-foreground">
              <CountUp value={stats.dmsSentWeek} />
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span>
                Today:{" "}
                <span className="font-semibold text-foreground">
                  <CountUp value={stats.dmsSentToday} />
                </span>
              </span>
              <span>
                This month:{" "}
                <span className="font-semibold text-foreground">
                  <CountUp value={stats.dmsSentMonth} />
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone weight="fill" className="size-4" />
              Automations on
            </CardTitle>
            <CardAction>
              <Link
                href="/campaigns"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                View all
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="font-display text-6xl leading-none text-foreground">
              <CountUp value={stats.activeAutomations} />
              <span className="text-lg font-medium text-muted-foreground">
                {" "}
                / {stats.totalAutomations}
              </span>
            </p>
            <div
              className="hr1 mt-3 h-3 overflow-hidden border-2 border-ink bg-paper"
              role="progressbar"
              aria-valuenow={stats.activeAutomations}
              aria-valuemin={0}
              aria-valuemax={stats.totalAutomations}
            >
              <div
                className="h-full bg-ok"
                style={{ width: `${campaignPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {campaignPct}% are on
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary metric strip — engagement + audience + health, no card boxes. */}
      <div className="hr3 grid grid-cols-2 gap-4 border-[2.5px] border-ink bg-paper2 px-5 py-5 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-border">
        <div className="sm:px-5 sm:first:pl-0">
          <p className="text-xs font-semibold text-muted-foreground">
            Clicks this month
          </p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums text-foreground">
            <CountUp value={stats.clicksThisMonth} />
          </p>
        </div>
        <div className="sm:px-5">
          <p className="text-xs font-semibold text-muted-foreground">
            Click rate
          </p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums text-foreground">
            <CountUp value={stats.ctrThisMonth} decimals={1} />
            <span className="text-sm font-medium text-muted-foreground">%</span>
          </p>
        </div>
        <div className="sm:px-5">
          <p className="text-xs font-semibold text-muted-foreground">
            Contacts
          </p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums text-foreground">
            <CountUp value={stats.contactsCount} />
          </p>
        </div>
        <div className="sm:px-5 sm:last:pr-0">
          <p className="text-xs font-semibold text-muted-foreground">
            Failed this month
          </p>
          <p
            className={`mt-1 font-display text-3xl leading-none tabular-nums ${
              stats.dmsFailedMonth > 0 ? "text-destructive" : "text-foreground"
            }`}
          >
            <CountUp value={stats.dmsFailedMonth} />
          </p>
        </div>
      </div>
    </>
  );
}

async function InsightsRegion({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard">["searchParams"];
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const selectedAccountId =
    typeof params.instagramAccountId === "string"
      ? params.instagramAccountId
      : "all";

  const stats = await getDashboardInsights(
    context.workspaceId,
    selectedAccountId === "all" ? null : selectedAccountId,
  );

  const maxKeyword = Math.max(...stats.topKeywords.map((k) => k.count), 0);

  return (
    <>
      {/* Chart + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 ">
        {/* 7-Day Chart */}
        <div className="lg:col-span-3">
          <DashboardChart data={stats.dailyDMs} />
        </div>

        {/* Top Keywords */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Top keywords</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.topKeywords.length === 0 ? (
                <div className="flex flex-col items-center py-4 text-center">
                  <CritterArt area="campaigns" mood="sleep" className="w-16" />
                  <p className="mt-1 text-sm text-muted-foreground">
                    No keywords hit yet. The beaver is waiting.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {stats.topKeywords.map((keyword) => (
                    <div key={keyword.keyword} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-foreground">
                          {keyword.keyword}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {keyword.count}
                        </span>
                      </div>
                      <div className="hr2 h-2.5 overflow-hidden border-[1.8px] border-ink bg-paper">
                        <div
                          className="h-full bg-fox"
                          style={{
                            width: `${maxKeyword ? (keyword.count / maxKeyword) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.recentLogs.length === 0 ? (
                <div className="flex flex-col items-center py-4 text-center">
                  <CritterArt area="home" mood="sleep" className="w-16" />
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nothing yet. The fox is having a nap.
                  </p>
                </div>
              ) : (
                <div className="max-h-64 divide-y divide-border overflow-y-auto pr-1">
                  {stats.recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          @{log.commenterName ?? "unknown"}
                          {log.automation && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              via {log.automation.name}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {log.instagramAccount
                            ? `@${log.instagramAccount.username} · `
                            : ""}
                          {log.commentText}
                        </p>
                      </div>
                      <StatusBadge status={log.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
