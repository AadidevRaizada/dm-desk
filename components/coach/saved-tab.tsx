"use client";

import { useState } from "react";
import { CaretDown, FilmSlate, Lightbulb, MagnifyingGlass, Sparkle, Trash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { HookPost } from "@/lib/server/hook-coach";
import type {
  AnalyzeInput,
  AnalyzeResult,
  CoachKind,
  FixResult,
  SavedAnalysis,
  WriteInput,
  WriteResult,
} from "@/lib/coach/types";
import { Button } from "@/components/ui/button";
import { HdEmpty } from "@/components/handdrawn/hd-bits";
import { useCoach } from "@/components/coach/context";
import { AnalyzeCard } from "@/components/coach/analyze-card";
import { FixResultView, SavedMeta, StoriesView } from "@/components/coach/story-card";

const FILTERS: Array<{ key: CoachKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "analyze", label: "Reviews" },
  { key: "fix", label: "Fixes" },
  { key: "write", label: "Ideas" },
];

const KIND_META: Record<CoachKind, { label: string; icon: typeof Sparkle; tone: string }> = {
  analyze: { label: "Review", icon: MagnifyingGlass, tone: "bg-owl" },
  fix: { label: "Fix", icon: Sparkle, tone: "bg-fox" },
  write: { label: "Idea", icon: Lightbulb, tone: "bg-parrot" },
};

function titleFor(a: SavedAnalysis, posts: HookPost[]): string {
  if (a.kind === "write") return (a.input as WriteInput | null)?.idea ?? "Idea";
  const post = a.mediaId ? posts.find((p) => p.id === a.mediaId) : undefined;
  if (post) return post.hook || "Reel without a caption";
  const input = (a.input ?? {}) as AnalyzeInput & { hook?: string };
  return input.fileName ?? input.hook ?? input.caption?.split("\n")[0] ?? "Reel";
}

function subtitleFor(a: SavedAnalysis): string {
  if (a.kind === "analyze") {
    const r = a.result as AnalyzeResult;
    if (r?.status === "pending") return "Working on it…";
    if (r?.status === "error") return "Failed";
    return `${r?.score?.toFixed(1) ?? "?"}/5 · ${r?.verdict ?? ""}`;
  }
  if (a.kind === "fix") {
    return (a.result as FixResult)?.stories?.[0]?.title ?? "";
  }
  return `${(a.result as WriteResult)?.stories?.length ?? 0} stories`;
}

function SavedItem({ a, posts }: { a: SavedAnalysis; posts: HookPost[] }) {
  const coach = useCoach();
  const [open, setOpen] = useState(false);
  const meta = KIND_META[a.kind];
  const Icon = meta.icon;
  const input = (a.input ?? {}) as AnalyzeInput & WriteInput;
  const key =
    a.kind === "write" ? "write" : `${a.kind}:${a.mediaId ?? input.uploadId}`;

  const redo =
    a.kind === "fix" && a.mediaId
      ? () => void coach.fix(a.mediaId!)
      : a.kind === "write" && input.idea
        ? () => void coach.write(input.idea, input.length ?? "short")
        : a.kind === "analyze"
          ? () =>
              void coach.analyze(
                a.mediaId ? { mediaId: a.mediaId } : { uploadId: input.uploadId }
              )
          : undefined;

  return (
    <li className="hr2 border-2 border-ink bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 p-3 text-left"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-ink",
            meta.tone
          )}
        >
          {a.kind === "analyze" && !a.mediaId ? (
            <FilmSlate weight="fill" className="size-4" />
          ) : (
            <Icon weight="fill" className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-sm font-medium text-foreground">
            {titleFor(a, posts)}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {meta.label} · {subtitleFor(a)}
          </span>
        </span>
        <CaretDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t-2 border-dashed border-ink/30 p-3">
          {a.kind === "analyze" ? (
            <AnalyzeCard
              analysis={a}
              personas={coach.personas}
              onRedo={redo}
              redoing={coach.busy[key]}
            />
          ) : (
            <>
              <SavedMeta
                analysis={a}
                personas={coach.personas}
                onRedo={redo}
                redoing={coach.busy[key]}
              />
              {a.kind === "fix" ? (
                <FixResultView result={a.result as FixResult} />
              ) : (
                <StoriesView stories={(a.result as WriteResult)?.stories ?? []} />
              )}
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              if (window.confirm("Delete this saved result?")) void coach.remove(a.id);
            }}
          >
            <Trash /> Delete
          </Button>
        </div>
      )}
    </li>
  );
}

export default function SavedTab({ posts }: { posts: HookPost[] }) {
  const coach = useCoach();
  const [filter, setFilter] = useState<CoachKind | "all">("all");
  const items = coach.analyses.filter((a) => filter === "all" || a.kind === filter);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "hr1 min-h-9 shrink-0 border-2 px-3 text-sm font-medium",
              filter === f.key
                ? "border-ink bg-paper2 text-foreground"
                : "border-ink/30 text-muted-foreground"
            )}
          >
            {f.label}
            <span className="ml-1 text-xs opacity-60">
              {f.key === "all"
                ? coach.analyses.length
                : coach.analyses.filter((a) => a.kind === f.key).length}
            </span>
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <HdEmpty
          area="hooks"
          title="Nothing saved yet"
          line="Fix, analyze or write a reel and it lands here, so you never pay for the same answer twice."
        />
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <SavedItem key={a.id} a={a} posts={posts} />
          ))}
        </ul>
      )}
    </div>
  );
}
