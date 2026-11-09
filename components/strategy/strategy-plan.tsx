"use client";

import { ArrowSquareOut, Star, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { api, shortWhen } from "@/components/strategy/strategy-shared";
import { sfx } from "@/lib/handdrawn";
import { gooeyToast } from "@/lib/hd-toast";
import type { Move, MoveAction, StrategyData } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");

/** This week: 7 days, main reels (filled), trials (outlined), best-slot stars. */
export function WeekStrip({ plan }: { plan: StrategyData["plan"] }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">
          {plan.mainCount}/{plan.target} main reels this week
        </p>
        <p className="flex items-center gap-2.5 whitespace-nowrap text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 border-2 border-ink bg-ink" /> main
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full border-2 border-ink" /> trial
          </span>
          <span className="flex items-center gap-1">
            <Star weight="fill" className="size-3 text-hd-accent" /> best slot
          </span>
        </p>
      </div>
      <ol className="mt-2 grid grid-cols-7 gap-1" aria-label="This week">
        {plan.days.map((d) => {
          const mains = d.posts.filter((p) => p.main);
          const trials = d.posts.filter((p) => !p.main);
          const gap = d.posts.length === 0;
          const open = d.bestSlot && plan.openSlots.includes(d.bestSlot);
          return (
            <li
              key={d.key}
              className={cn(
                "hr1 flex min-h-24 flex-col items-center gap-1 border-2 px-0.5 py-1.5 text-center",
                gap ? "border-dashed border-ink/50 bg-transparent" : "border-ink bg-paper2",
                open && "border-hd-accent"
              )}
              title={d.posts.map((p) => `${p.main ? "Main" : "Trial"} · ${shortWhen(p.at)} · ${p.label}`).join("\n") || undefined}
            >
              <span className="font-display text-sm leading-none sm:text-base">{d.label}</span>
              <span className="flex flex-wrap justify-center gap-0.5" aria-label={`${mains.length} main, ${trials.length} trial`}>
                {mains.map((p) => (
                  <span
                    key={p.id}
                    className={cn("inline-block size-3 border-2 border-ink", p.status === "PUBLISHED" ? "bg-ink" : "bg-ink/60")}
                  />
                ))}
                {trials.map((p) => (
                  <span key={p.id} className="inline-block size-3 rounded-full border-2 border-ink" />
                ))}
              </span>
              {d.bestSlot ? (
                <span className={cn("mt-auto flex items-center gap-0.5 text-[10px] leading-none", open ? "font-semibold text-hd-accent" : "text-muted-foreground")}>
                  <Star weight={open ? "fill" : "regular"} className="size-2.5" />
                  {hourLabel(d.bestSlot)}
                </span>
              ) : (
                <span className="mt-auto text-[10px] text-muted-foreground">{gap ? "–" : ""}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{plan.slotsNote} Trials don&apos;t count toward the 3.</p>
    </div>
  );
}

export function MovesList({
  moves,
  onAction,
  onChanged,
}: {
  moves: Move[];
  onAction: (action: MoveAction) => void;
  onChanged: () => Promise<void> | void;
}) {
  if (moves.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to do right now. Your week looks good.</p>;
  }
  return (
    <ul className="space-y-3">
      {moves.map((m, i) => (
        <li
          key={m.id}
          className={cn(
            "border-2 border-ink bg-card p-3",
            i % 3 === 0 ? "hr2" : i % 3 === 1 ? "hr1" : "hr3",
            m.kind === "push_winner" && "border-ok bg-ok/10",
            m.kind === "warning" && "border-hd-accent"
          )}
        >
          <p className="flex items-start gap-1.5 font-display text-xl leading-tight">
            {m.kind === "warning" ? <WarningCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-hd-accent" /> : null}
            {m.title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{m.reason}</p>
          {m.action.type === "push_winner" ? (
            <PushWinnerButtons experimentId={m.action.experimentId} permalink={m.action.permalink} onDone={onChanged} />
          ) : (
            <Button
              size="sm"
              variant={m.kind === "warning" ? "outline" : "hero"}
              className="clicky mt-2.5 h-11 w-full text-base sm:w-auto sm:px-5"
              onClick={() => onAction(m.action)}
            >
              {m.cta}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "Open in Instagram → Share to everyone" + "Done, I shared it". */
export function PushWinnerButtons({
  experimentId,
  permalink,
  onDone,
}: {
  experimentId: string;
  permalink: string | null;
  onDone: () => Promise<void> | void;
}) {
  return (
    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
      {permalink ? (
        <a
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="hr2 clicky inline-flex h-11 items-center justify-center gap-1.5 border-2 border-ink bg-ink px-3 text-base font-semibold text-paper"
        >
          Open in Instagram <ArrowSquareOut className="size-4" />
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          Open the winning reel in Instagram (profile → Reels → trial reels).
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        className="clicky h-11 text-base"
        onClick={async () => {
          if (await api(`/api/strategy/experiments/${experimentId}`, { method: "PATCH", json: { action: "shared" } })) {
            sfx("yes");
            gooeyToast.success("Nice. Logged as shared to everyone.");
            await onDone();
          }
        }}
      >
        Done, I shared it
      </Button>
      <p className="text-[11px] text-muted-foreground sm:col-span-2">
        Open the trial reel in Instagram and tap “Share to everyone”. Apps can&apos;t do this step for you, so come back and tap Done.
      </p>
    </div>
  );
}
