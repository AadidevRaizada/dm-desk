"use client";

import { useState } from "react";
import { analysisToPrompt } from "@/lib/coach/export";
import { ArrowClockwise, Check, Copy, SpinnerGap } from "@phosphor-icons/react";
import { gooeyToast } from "@/lib/hd-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BEAT_LABELS,
  storyDuration,
  storyToScript,
  type BeatType,
} from "@/lib/hook-coach-story";
import type {
  CoachPersonaData,
  FixProblem,
  FixResult,
  SavedAnalysis,
  StoryWithRetention,
} from "@/lib/coach/types";
import { RetentionChip } from "@/components/coach/retention-chip";

// Story beats wear critter colours with an ink outline (hand-drawn style).
const BEAT_STYLES: Record<BeatType, { chip: string; rail: string }> = {
  hook: { chip: "hr1 bg-fox text-ink", rail: "bg-fox" },
  content: { chip: "hr2 bg-elephant text-ink", rail: "bg-elephant" },
  rehook: { chip: "hr3 bg-owl text-ink", rail: "bg-owl" },
  payoff: { chip: "hr1 bg-parrot text-ink", rail: "bg-parrot" },
};

export const PROBLEM_LABELS: Record<FixProblem, string> = {
  hook: "Hook problem",
  content: "Lost before the payoff",
  payoff: "Weak payoff",
  unknown: "What to tighten",
};

export function CopyButton({
  text,
  label = "Copy",
  toast = "Copied",
  className,
  iconOnly,
}: {
  text: string;
  label?: string;
  toast?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      gooeyToast.success(toast);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      gooeyToast.error("Couldn't copy. Long-press the text instead.");
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon-sm" : "sm"}
      onClick={() => void copy()}
      className={cn("shrink-0", className)}
      aria-label={iconOnly ? label : undefined}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {!iconOnly && (copied ? "Copied" : label)}
    </Button>
  );
}

export function StoryCard({
  story,
  index,
}: {
  story: StoryWithRetention;
  index?: number;
}) {
  const total = storyDuration(story);
  return (
    <article className="hr3 border-2 border-ink bg-paper p-3 sm:p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {index !== undefined && (
            <p className="text-xs font-medium text-muted-foreground">
              Option {index + 1}
              {total !== null && ` · ~${total}s`}
            </p>
          )}
          <h3 className="font-display text-xl leading-tight text-foreground wrap-break-word">
            {story.title}
            {index === undefined && total !== null && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · ~{total}s
              </span>
            )}
          </h3>
        </div>
        <CopyButton
          text={storyToScript(story)}
          label="Copy script"
          toast="Script copied"
        />
      </header>

      <RetentionChip value={story.expectedRetention} className="mb-3" />

      <ol className="space-y-2.5">
        {story.beats.map((beat, i) => {
          const style = BEAT_STYLES[beat.type];
          return (
            <li key={i} className="flex gap-2.5">
              <span
                aria-hidden
                className={cn("w-1.5 shrink-0 rounded-full border border-ink", style.rail)}
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 border-[1.8px] border-ink px-2 py-0.5 text-[11px] font-semibold",
                    style.chip
                  )}
                >
                  {BEAT_LABELS[beat.type]}
                  {typeof beat.seconds === "number" && (
                    <span className="font-normal opacity-80">· {beat.seconds}s</span>
                  )}
                </span>
                <p
                  className={cn(
                    "mt-1 text-sm text-foreground wrap-break-word",
                    beat.type === "hook" && "font-semibold"
                  )}
                >
                  {beat.text}
                </p>
                {beat.onScreenText && (
                  <p className="mt-0.5 text-xs text-muted-foreground wrap-break-word">
                    On screen: {beat.onScreenText}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(story.whyItWorks || story.styleBorrowedFrom) && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
          {story.whyItWorks && (
            <>
              <span className="font-medium text-foreground">Why it works: </span>
              {story.whyItWorks}
            </>
          )}
          {story.styleBorrowedFrom && (
            <span className="mt-1 block">Style: {story.styleBorrowedFrom}</span>
          )}
        </p>
      )}
    </article>
  );
}

/** Persona + date + a small Redo button, shown above every saved result. */
export function SavedMeta({
  analysis,
  personas,
  onRedo,
  redoing,
}: {
  analysis: SavedAnalysis;
  personas: CoachPersonaData[];
  onRedo?: () => void;
  redoing?: boolean;
}) {
  const persona = personas.find((p) => p.id === analysis.personaId);
  const date = new Date(analysis.createdAt);
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        Saved{" "}
        {date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        {persona && (
          <>
            {" "}
            · {persona.emoji} {persona.name}
          </>
        )}
      </span>
      {(analysis.result as { status?: string } | null)?.status !== "pending" &&
        (analysis.result as { status?: string } | null)?.status !== "error" && (
          <CopyButton
            text={analysisToPrompt(analysis, persona)}
            label="Copy as prompt"
            toast="Copied. Paste it into Claude to make the reel."
          />
        )}
      {onRedo && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onRedo}
          disabled={redoing}
          className="shrink-0"
        >
          {redoing ? <SpinnerGap className="animate-spin" /> : <ArrowClockwise />}
          Redo
        </Button>
      )}
    </div>
  );
}

export function FixResultView({ result }: { result: FixResult }) {
  return (
    <div className="space-y-3">
      {result.diagnosis && (
        <div className="hr2 border-2 border-dashed border-ink/60 bg-paper2 p-3 text-sm text-foreground">
          <p className="mb-1 font-display text-lg leading-tight text-foreground">
            {result.problem ? PROBLEM_LABELS[result.problem] : "What went wrong"}
          </p>
          {result.diagnosis}
        </div>
      )}
      {(result.stories ?? []).map((story, i) => (
        <StoryCard key={`${i}-${story.title}`} story={story} />
      ))}
    </div>
  );
}

export function StoriesView({ stories }: { stories: StoryWithRetention[] }) {
  return (
    <div className="space-y-3">
      {stories.map((story, i) => (
        <StoryCard
          key={`${i}-${story.title}`}
          story={story}
          index={stories.length > 1 ? i : undefined}
        />
      ))}
    </div>
  );
}
