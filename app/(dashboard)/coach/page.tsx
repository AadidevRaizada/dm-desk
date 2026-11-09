/**
 * Coach Page (Server Component)
 *
 * Chat with a coach persona, fix / analyze reels (weakest first) and browse
 * saved results. Every reel is a story: hook -> content -> payoff. Data comes
 * from `getHookData` (30-minute snapshot) plus the saved Coach rows;
 * everything interactive lives in the `CoachApp` client component.
 */

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  InstagramLogo,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import CoachApp, { type CoachTab } from "@/components/coach/coach-app";
import { buttonVariants } from "@/components/ui/button";
import { HdEmpty } from "@/components/handdrawn/hd-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getHookData } from "@/lib/server/hook-coach";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";
import { DEFAULT_REFERENCES } from "@/lib/hook-coach-story";
import { formatTimeAgo } from "@/lib/utils/time";
import { prisma } from "@/lib/db/client";
import { listPersonas } from "@/lib/server/coach/personas";
import { listAnalyses } from "@/lib/server/coach/analyses";
import {
  canManageInstagramAccounts,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// A cold snapshot means paginated media + ~30 per-post insight calls.
export const maxDuration = 60;

function CoachSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className={cn(
              "hr2 border-[2.5px] border-ink bg-card p-4",
              i === 2 && "col-span-2 sm:col-span-1"
            )}
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-6 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

function EmptyCard({
  title,
  body,
  action,
  mood = "sleep",
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  mood?: "work" | "sleep";
}) {
  return <HdEmpty area="hooks" mood={mood} title={title} line={body} action={action || null} />;
}

export default async function CoachPage(props: PageProps<"/coach">) {
  return (
    <div className="space-y-8">
      <Suspense fallback={<CoachSkeleton />}>
        <CoachContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function CoachContent({
  searchParams,
}: {
  searchParams: PageProps<"/coach">["searchParams"];
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const accountId =
    typeof params.instagramAccountId === "string"
      ? params.instagramAccountId
      : null;

  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const initialTab: CoachTab =
    tabParam === "chat" || tabParam === "saved" ? tabParam : "reels";

  const [result, profile, personas, analyses, chats] = await Promise.all([
    getHookData(context.workspaceId, accountId),
    getHookCoachProfile(context.workspaceId).catch(() => ({
      niche: "",
      audience: "",
      cta: "",
      references: [...DEFAULT_REFERENCES],
      saved: false,
    })),
    listPersonas(context.workspaceId),
    listAnalyses(context.workspaceId),
    prisma.coachChat.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: { id: true, title: true, personaId: true, updatedAt: true },
    }),
  ]);

  if (result.status === "no_account") {
    return (
      <EmptyCard
        icon={<InstagramLogo className="size-5" />}
        title="No Instagram account yet"
        body="Connect your account and the otter will show which openings keep people watching."
        action={
          canManageInstagramAccounts(context) && (
            <Link
              href="/api/instagram/connect"
              className={cn(buttonVariants({ variant: "default" }))}
            >
              Connect Instagram
            </Link>
          )
        }
      />
    );
  }

  if (result.status === "error") {
    return (
      <EmptyCard
        icon={<WarningCircle className="size-5" />}
        mood="work"
        title="Couldn't load your posts"
        body={result.message}
        action={
          <Link
            href="/coach"
            className={cn(
              buttonVariants({ variant: "outline" })
            )}
          >
            Try again
          </Link>
        }
      />
    );
  }

  const { data } = result;
  if (data.posts.length === 0) {
    return (
      <EmptyCard
        icon={<InstagramLogo className="size-5" />}
        title="No posts yet"
        body="Post a few reels and the otter will coach you on them here."
      />
    );
  }

  return (
    <CoachApp
      data={data}
      profile={profile}
      updatedLabel={formatTimeAgo(data.fetchedAt)}
      accountId={accountId}
      personas={personas}
      analyses={analyses}
      chats={chats.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }))}
      initialTab={initialTab}
    />
  );
}
