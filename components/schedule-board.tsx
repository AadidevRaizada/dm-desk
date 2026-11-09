"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import ScheduleForm from "@/components/schedule-form";
import ScheduleList from "@/components/schedule-list";
import { ExperimentsList } from "@/components/strategy/strategy-experiments";
import { HookTestFlow, Segmented } from "@/components/strategy/strategy-hook-test";
import { MovesList, WeekStrip } from "@/components/strategy/strategy-plan";
import { RemixFlow } from "@/components/strategy/strategy-remix";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScheduleData } from "@/lib/scheduling/queries";
import type { TestVariable } from "@/lib/strategy/config";
import type { MoveAction, StrategyData } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

type Tab = "experiments" | "queue" | "new";
type NewMode = "one" | "test" | "remix";

interface Prefill {
  nonce: number;
  mediaId: string | null;
  at: string | null;
  caption: string | null;
  variable: TestVariable | null;
}

export default function ScheduleBoard({
  initial,
  canEdit,
}: {
  initial: ScheduleData;
  canEdit: boolean;
}) {
  const [data, setData] = useState(initial);
  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() =>
    initial.posts.some((p) => p.status !== "PUBLISHED") ? "queue" : "new"
  );
  const [mode, setMode] = useState<NewMode>("one");
  const [prefill, setPrefill] = useState<Prefill>({ nonce: 0, mediaId: null, at: null, caption: null, variable: null });
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabPicked = useRef(false);

  const refreshQueue = useCallback(async () => {
    const res = await fetch("/api/schedule", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as ScheduleData);
  }, []);

  const refreshStrategy = useCallback(async () => {
    try {
      const res = await fetch("/api/strategy", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as StrategyData & { error?: string };
      if (!res.ok) {
        setStrategyError(body.error ?? "Couldn't load your plan.");
        return;
      }
      setStrategy(body);
      setStrategyError(null);
      // First load: open Experiments when something is being tested.
      if (!tabPicked.current) {
        tabPicked.current = true;
        if (body.experiments.some((e) => e.status !== "cancelled")) setTab("experiments");
      }
    } catch {
      setStrategyError("No connection.");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshQueue(), refreshStrategy()]);
  }, [refreshQueue, refreshStrategy]);

  // Load the plan after first paint (it may call Instagram on a cold cache).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void refreshStrategy();
  }, [refreshStrategy]);

  // While variants render, poll so the card flips to Scheduled.
  const rendering = strategy?.experiments.some((e) => e.status === "draft") ?? false;
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => void refreshAll(), 5000);
    return () => clearInterval(t);
  }, [rendering, refreshAll]);

  function go(nextTab: Tab, nextMode?: NewMode, fill?: Partial<Omit<Prefill, "nonce">>) {
    tabPicked.current = true;
    setTab(nextTab);
    if (nextMode) setMode(nextMode);
    if (fill) {
      setPrefill((p) => ({
        nonce: p.nonce + 1,
        mediaId: fill.mediaId ?? null,
        at: fill.at ?? null,
        caption: fill.caption ?? null,
        variable: fill.variable ?? null,
      }));
    }
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function onMove(action: MoveAction) {
    switch (action.type) {
      case "remix":
        return go("new", "remix", { mediaId: action.mediaId });
      case "test_hooks":
        return go("new", "test", { mediaId: action.mediaId });
      case "plan_post":
        return go("new", "one", { at: action.at, caption: action.captionSeed });
      case "open_queue":
        return go("queue");
      case "push_winner":
        return go("experiments");
    }
  }

  const noAccount = data.accounts.length === 0;
  const liveTests = strategy?.experiments.filter((e) => e.status !== "cancelled").length ?? 0;
  const queued = data.posts.filter((p) => p.status !== "PUBLISHED").length;

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

      {!noAccount ? (
        <section aria-labelledby="plan-title" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="hr1 border-[2.5px] border-ink bg-card p-3 sm:p-4">
            <h2 id="plan-title" className="font-display text-2xl leading-none">Your plan</h2>
            <div className="mt-3">
              {strategy ? (
                <WeekStrip plan={strategy.plan} />
              ) : strategyError ? (
                <p className="text-sm text-muted-foreground">{strategyError}</p>
              ) : (
                <Skeleton className="h-28 w-full" />
              )}
            </div>
            {strategy?.insights === "error" && strategy.insightsMessage ? (
              <p className="mt-2 text-xs text-muted-foreground">{strategy.insightsMessage}</p>
            ) : null}
          </div>
          <div>
            <h2 className="mb-2 font-display text-2xl leading-none">Suggested moves</h2>
            {strategy ? (
              <MovesList moves={canEdit ? strategy.moves : []} onAction={onMove} onChanged={refreshAll} />
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </div>
        </section>
      ) : null}

      <div ref={tabsRef} className="scroll-mt-4">
        <div className="mb-4 grid grid-cols-3 gap-1.5 sm:max-w-md" role="tablist" aria-label="Schedule sections">
          {(
            [
              ["experiments", `Tests${liveTests ? ` ${liveTests}` : ""}`],
              ["queue", `Queue${queued ? ` ${queued}` : ""}`],
              ["new", "New"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                tabPicked.current = true;
                setTab(t);
              }}
              className={cn(
                "hr2 clicky min-h-11 border-2 border-ink px-2 font-display text-lg leading-none",
                tab === t ? "bg-ink text-paper" : "bg-paper2"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "experiments" ? (
          strategy ? (
            <ExperimentsList
              experiments={strategy.experiments}
              canEdit={canEdit}
              onChanged={refreshAll}
              onRetest={(mediaId, variable) =>
                go("new", "test", { mediaId, variable: variable === "first_frame" ? "first_frame" : "hook" })
              }
            />
          ) : (
            <Skeleton className="h-40 w-full" />
          )
        ) : tab === "queue" ? (
          <ScheduleList posts={data.posts} canEdit={canEdit} onChange={refreshAll} />
        ) : noAccount ? (
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
        ) : !canEdit ? (
          <p className="text-sm text-muted-foreground">
            You can see the schedule but not change it in this workspace.
          </p>
        ) : (
          <div className="max-w-2xl space-y-4">
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as NewMode)}
              options={[
                ["one", "One reel"],
                ["test", "Test hooks"],
                ["remix", "Remix & repost"],
              ]}
            />
            {mode === "one" ? (
              <ScheduleForm
                key={`one-${prefill.nonce}`}
                accounts={data.accounts}
                topPostTimestamps={data.topPostTimestamps}
                initialWhen={prefill.at ?? strategy?.nextMainSlot ?? null}
                initialCaption={prefill.caption}
                onScheduled={async () => {
                  await refreshAll();
                  setTab("queue");
                }}
              />
            ) : !strategy ? (
              <Skeleton className="h-60 w-full" />
            ) : mode === "test" ? (
              <HookTestFlow
                key={`test-${prefill.nonce}`}
                data={strategy}
                initialMediaId={prefill.mediaId}
                initialVariable={prefill.variable === "first_frame" ? "first_frame" : "hook"}
                onCreated={async () => {
                  await refreshAll();
                  setTab("experiments");
                }}
              />
            ) : (
              <RemixFlow
                key={`remix-${prefill.nonce}`}
                data={strategy}
                initialMediaId={prefill.mediaId}
                onCreated={async () => {
                  await refreshAll();
                  setTab("experiments");
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
