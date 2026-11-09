"use client";

import { useState } from "react";
import { ArrowSquareOut, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { HdEmpty, HdStamp } from "@/components/handdrawn/hd-bits";
import { PushWinnerButtons } from "@/components/strategy/strategy-plan";
import { api, ExperimentBadge, pct, shortWhen, useArmed } from "@/components/strategy/strategy-shared";
import { gooeyToast } from "@/lib/hd-toast";
import {
  FINAL_DECISION_HOURS,
  MIN_REACH_PER_VARIANT,
  VARIABLE_LABEL,
  type TestVariable,
} from "@/lib/strategy/config";
import { isTerminal, type ExperimentView, type VariantView } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

export function ExperimentsList({
  experiments,
  canEdit,
  onChanged,
  onRetest,
}: {
  experiments: ExperimentView[];
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
  onRetest: (mediaId: string | null, variable: TestVariable) => void;
}) {
  if (experiments.length === 0) {
    return (
      <HdEmpty
        area="hooks"
        title="No tests yet"
        line="Test up to 5 hooks as trial reels. Only non-followers see them, and the winner gets called after 48–72 h."
      />
    );
  }
  return (
    <ul className="space-y-4">
      {experiments.map((e, i) => (
        <ExperimentCard key={e.id} e={e} idx={i} canEdit={canEdit} onChanged={onChanged} onRetest={onRetest} />
      ))}
    </ul>
  );
}

function ExperimentCard({
  e,
  idx,
  canEdit,
  onChanged,
  onRetest,
}: {
  e: ExperimentView;
  idx: number;
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
  onRetest: (mediaId: string | null, variable: TestVariable) => void;
}) {
  const winner = e.variants.find((v) => v.id === e.winnerPostId) ?? null;
  const awaitingShare = e.status === "decided" && winner?.trial && !winner.graduatedAt && !e.decision?.repostedPostId;
  const scoreById = new Map((e.decision?.scores ?? []).map((s) => [s.postId, s]));
  const maxScore = Math.max(0.01, ...[...scoreById.values()].map((s) => s.score ?? 0));

  return (
    <li className={cn("border-[2.5px] border-ink bg-card p-3 sm:p-4", idx % 2 ? "hr1" : "hr2")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-xl leading-tight">{e.name}</p>
          <p className="text-xs text-muted-foreground">
            {e.kind === "repost" ? "Remix & repost" : `${VARIABLE_LABEL[e.variable]} test · ${e.variants.length || e.progress?.total || ""} trial reels`}
            {e.startAt ? ` · from ${shortWhen(e.startAt)}` : ""}
          </p>
        </div>
        {e.status === "decided" && e.kind === "ab_test" ? (
          <HdStamp>Winner!</HdStamp>
        ) : (
          <ExperimentBadge status={e.status} progress={e.progress} />
        )}
      </div>

      {e.error ? <p className="mt-2 text-sm text-destructive">{e.error}</p> : null}
      {e.status === "draft" ? (
        <p className="mt-2 text-sm text-muted-foreground">Burning in the hooks… this takes about a minute.</p>
      ) : null}

      {e.variants.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {e.variants.map((v) => (
            <VariantRow key={v.id} v={v} score={scoreById.get(v.id)?.score ?? null} maxScore={maxScore} isWinner={v.id === e.winnerPostId} />
          ))}
        </ul>
      ) : null}

      {e.decision && e.status !== "draft" ? (
        <div className="mt-3 text-sm">
          <p className={cn(e.status === "decided" ? "font-semibold" : "text-muted-foreground")}>{e.decision.reason}</p>
          {e.status === "no_winner" && e.decision.nextReason ? (
            <p className="mt-1 text-muted-foreground">Next: {e.decision.nextReason}</p>
          ) : null}
          {e.decision.reference ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Scores are percentiles vs your own {e.decision.reference === "trials" ? "trial reels" : e.decision.reference === "reels" ? "reels" : "variants"}; each variant needs {MIN_REACH_PER_VARIANT}+ reach. Final call at {FINAL_DECISION_HOURS} h.
            </p>
          ) : null}
        </div>
      ) : e.status === "scheduled" || e.status === "running" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Numbers come in at 24 h; first call at 48 h, final at {FINAL_DECISION_HOURS} h.
        </p>
      ) : null}

      {canEdit && awaitingShare ? (
        <>
          <PushWinnerButtons experimentId={e.id} permalink={winner?.permalink ?? null} onDone={onChanged} />
          <RepostWinner experimentId={e.id} onDone={onChanged} />
        </>
      ) : null}
      {winner?.graduatedAt ? <p className="mt-2 text-sm font-semibold text-ok">Shared to everyone ✓</p> : null}
      {e.decision?.repostedPostId ? <p className="mt-2 text-sm font-semibold">Scheduled for followers as a normal reel ✓</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canEdit && e.status === "no_winner" && e.kind === "ab_test" ? (
          <Button size="sm" className="clicky h-10" onClick={() => onRetest(e.sourceMediaId, e.decision?.nextVariable ?? e.variable)}>
            Re-test{e.decision?.nextVariable ? `: ${VARIABLE_LABEL[e.decision.nextVariable].toLowerCase()}` : ""}
          </Button>
        ) : null}
        {canEdit && !isTerminal(e.status) ? <CancelButton id={e.id} onDone={onChanged} /> : null}
      </div>
    </li>
  );
}

function VariantRow({ v, score, maxScore, isWinner }: { v: VariantView; score: number | null; maxScore: number; isWinner: boolean }) {
  const [coverOk, setCoverOk] = useState(v.hasCover);
  const m = v.metrics;
  const watchPct = m?.avgWatchMs != null && v.durationSec ? m.avgWatchMs / 1000 / v.durationSec : null;
  const hold = m?.skipRate != null ? 1 - m.skipRate : null;
  const spr = m?.shares != null && m.reach ? m.shares / m.reach : null;
  return (
    <li className={cn("flex gap-2.5 border-2 bg-paper2 p-2", isWinner ? "hr3 border-ok" : "hr1 border-ink/60")}>
      <div className="hr2 aspect-9/16 w-11 shrink-0 overflow-hidden border-2 border-ink bg-paper">
        {coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/schedule/${v.id}/cover`} alt="" className="size-full object-cover" loading="lazy" onError={() => setCoverOk(false)} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-start gap-1.5 text-sm">
          <span className="font-display text-lg leading-none">{v.label}</span>
          <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{v.hook ?? "(no hook text)"}</span>
          {isWinner ? (
            <span className="hr3 shrink-0 border-2 border-ok bg-ok/20 px-1.5 font-display text-sm leading-tight">Winner</span>
          ) : null}
        </p>
        {m ? (
          <>
            <div className="mt-1 h-2.5 overflow-hidden border-2 border-ink bg-paper" role="img" aria-label={`Score ${pct(score)}`}>
              <div className={cn("h-full", isWinner ? "bg-ok" : "bg-ink/70")} style={{ width: `${Math.round(((score ?? 0) / maxScore) * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              score {pct(score)} · reach {m.reach ?? "–"} · hold {pct(hold)} · watch {pct(watchPct)} · shares {pct(spr, 1)}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {v.status === "PUBLISHED"
              ? `Out ${v.publishedAt ? shortWhen(v.publishedAt) : ""} · numbers at 24 h`
              : v.status === "FAILED"
                ? `Failed: ${v.error ?? "see queue"}`
                : v.status === "PUBLISHING"
                  ? "Posting now…"
                  : `Goes out ${shortWhen(v.scheduledAt)}`}
          </p>
        )}
      </div>
      {v.permalink ? (
        <a href={v.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open variant ${v.label} in Instagram`} className="grid size-10 shrink-0 place-items-center">
          <ArrowSquareOut className="size-4" />
        </a>
      ) : null}
    </li>
  );
}

function RepostWinner({ experimentId, onDone }: { experimentId: string; onDone: () => Promise<void> | void }) {
  const [armed, arm] = useArmed();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2">
      <Button
        size="sm"
        variant={armed ? "destructive" : "ghost"}
        disabled={busy}
        className="h-auto min-h-10 whitespace-normal px-0 text-left text-sm underline decoration-wavy underline-offset-4"
        onClick={async () => {
          if (!arm()) return;
          setBusy(true);
          const res = await api<{ scheduledAt: string }>(`/api/strategy/experiments/${experimentId}`, {
            method: "PATCH",
            json: { action: "repost_winner" },
          });
          setBusy(false);
          if (res) {
            gooeyToast.success(`Scheduled for followers ${shortWhen(res.scheduledAt)}`);
            await onDone();
          }
        }}
      >
        {armed ? "Sure? It's a duplicate of the trial" : "Or repost the winner to followers as a normal reel"}
      </Button>
      {armed ? (
        <p className="text-[11px] text-muted-foreground">
          Sharing the trial keeps its views and comments. A repost starts from zero and Instagram may treat it as duplicate content.
        </p>
      ) : null}
    </div>
  );
}

function CancelButton({ id, onDone }: { id: string; onDone: () => Promise<void> | void }) {
  const [armed, arm] = useArmed();
  return (
    <Button
      size="sm"
      variant={armed ? "destructive" : "ghost"}
      className="clicky h-10"
      onClick={async () => {
        if (!arm()) return;
        if (await api(`/api/strategy/experiments/${id}`, { method: "PATCH", json: { action: "cancel" } })) {
          gooeyToast.success("Test cancelled. Unposted variants removed.");
          await onDone();
        }
      }}
    >
      <Trash /> {armed ? "Sure? Cancel test" : "Cancel test"}
    </Button>
  );
}
