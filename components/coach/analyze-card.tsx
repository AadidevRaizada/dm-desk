"use client";

import { Lightning, Megaphone, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  clock,
  type AnalyzeResult,
  type AnalyzeStage,
  type CoachPersonaData,
  type ExpectedRetention,
  type SavedAnalysis,
} from "@/lib/coach/types";
import { RetentionChip } from "@/components/coach/retention-chip";
import { CopyButton, SavedMeta } from "@/components/coach/story-card";

const STAGES: Array<{ key: AnalyzeStage; label: string }> = [
  { key: "downloading", label: "Getting the video" },
  { key: "frames", label: "Watching it frame by frame" },
  { key: "transcribing", label: "Listening to what you say" },
  { key: "thinking", label: "Writing the breakdown" },
];

function scoreTone(score: number) {
  if (score >= 4) return "bg-parrot";
  if (score >= 2.5) return "bg-owl";
  return "bg-fox";
}

function Pending({ stage }: { stage?: AnalyzeStage }) {
  const current = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="hr2 space-y-2 border-2 border-dashed border-ink/60 bg-paper2 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <SpinnerGap className="size-4 animate-spin" />
        Watching the whole reel… (about a minute)
      </p>
      <ol className="space-y-1 text-xs">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            className={cn(
              "flex items-center gap-2",
              i < current
                ? "text-muted-foreground line-through"
                : i === current
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full border border-ink",
                i <= current ? "bg-parrot" : "bg-wash"
              )}
            />
            {s.label}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        You can leave this page; it&apos;s saved when it&apos;s done.
      </p>
    </div>
  );
}

/** Creedom-style reel review: score, verdict, second-by-second, hooks, CTAs. */
export function AnalyzeCard({
  analysis,
  personas,
  onRedo,
  redoing,
  compact,
}: {
  analysis: SavedAnalysis;
  personas: CoachPersonaData[];
  onRedo?: () => void;
  redoing?: boolean;
  compact?: boolean;
}) {
  const r = (analysis.result ?? { status: "error" }) as AnalyzeResult;
  const retention = analysis.expectedRetention as ExpectedRetention | null;
  const posted = analysis.mediaId !== null;

  if (r.status === "pending") return <Pending stage={r.stage} />;
  if (r.status === "error") {
    return (
      <div className="space-y-1.5">
        <SavedMeta analysis={analysis} personas={personas} onRedo={onRedo} redoing={redoing} />
        <p className="flex items-start gap-2 text-sm text-destructive">
          <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
          {r.error ?? "This analysis failed. Tap Redo."}
        </p>
      </div>
    );
  }

  const score = r.score ?? 0;
  return (
    <article className="hr3 space-y-4 border-2 border-ink bg-paper p-3 sm:p-4">
      <SavedMeta analysis={analysis} personas={personas} onRedo={onRedo} redoing={redoing} />

      {/* Score */}
      <header className="flex items-start gap-3">
        <div className="hr1 flex shrink-0 flex-col items-center border-2 border-ink bg-paper2 px-3 py-1.5">
          <span className="font-display text-4xl leading-none tabular-nums text-foreground">
            {score.toFixed(1)}
          </span>
          <span className="text-[11px] text-muted-foreground">out of 5</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-2xl leading-tight text-foreground wrap-break-word">
            {r.verdict ?? "Reel review"}
          </h3>
          <div
            className="mt-1.5 h-3 rounded-full border-2 border-ink bg-wash"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={score}
            aria-label="Score"
          >
            <div
              className={cn("h-full rounded-full", scoreTone(score))}
              style={{ width: `${(score / 5) * 100}%` }}
            />
          </div>
          {r.durationSec ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {clock(r.durationSec)} long · watched {r.frameCount ?? 0} frames
              {r.transcribed ? " + transcript" : ""}
            </p>
          ) : null}
        </div>
      </header>

      {r.summary && <p className="text-sm text-foreground">{r.summary}</p>}
      {!r.transcribed && r.transcriptNote && (
        <p className="text-xs text-warning">{r.transcriptNote}</p>
      )}

      <RetentionChip
        value={retention}
        title={posted ? "With these changes" : "Expected if posted as is"}
      />

      {/* Second by second */}
      {(r.sections?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 font-display text-xl leading-tight text-foreground">
            Second by second
          </h4>
          <ol className="relative space-y-3 pl-5">
            <span
              aria-hidden
              className="absolute top-1.5 bottom-1.5 left-[5px] w-0.5 bg-ink/30"
            />
            {r.sections!.map((s, i) => (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1 -left-5 size-3 rounded-full border-2 border-ink",
                    i === 0
                      ? "bg-fox"
                      : i === r.sections!.length - 1
                        ? "bg-parrot"
                        : "bg-elephant"
                  )}
                />
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-foreground">{s.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {clock(s.start)}–{clock(s.end)}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-foreground/90 wrap-break-word">
                  {s.note}
                </p>
                {s.change && !compact && (
                  <p className="hr2 mt-1.5 border-[1.5px] border-ink bg-owl/40 px-2 py-1.5 text-sm text-foreground wrap-break-word">
                    <span className="font-semibold">Change: </span>
                    {s.change}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Viral hooks */}
      {(r.viralHooks?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 font-display text-xl leading-tight text-foreground">
            <Lightning weight="fill" className="size-4 text-hd-accent" />
            Hooks that would&apos;ve made it viral
          </h4>
          <ol className="space-y-2">
            {r.viralHooks!.map((h, i) => (
              <li
                key={i}
                className="hr1 flex items-start gap-2 border-[1.5px] border-ink bg-paper2 px-2.5 py-2"
              >
                <span className="font-display text-lg leading-none text-muted-foreground">
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 text-sm font-semibold text-foreground wrap-break-word">
                  {h}
                </p>
                <CopyButton text={h} label="Copy hook" toast="Hook copied" iconOnly />
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* CTAs */}
      {(r.ctaScripts?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 flex items-center gap-1.5 font-display text-xl leading-tight text-foreground">
            <Megaphone weight="fill" className="size-4" />
            CTA that drives shares &amp; saves
          </h4>
          <ul className="space-y-2">
            {r.ctaScripts!.map((c, i) => (
              <li
                key={i}
                className="hr2 flex items-start gap-2 border-[1.5px] border-ink bg-paper2 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  {c.placementSec !== null && (
                    <span className="mb-1 inline-block border-[1.5px] border-ink bg-parrot px-1.5 text-[11px] font-semibold text-ink">
                      Say it at {clock(c.placementSec)}
                    </span>
                  )}
                  <p className="text-sm text-foreground wrap-break-word">{c.text}</p>
                </div>
                <CopyButton text={c.text} label="Copy CTA" toast="CTA copied" iconOnly />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
