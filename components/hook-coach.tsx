"use client";

/**
 * Coach "Reels" tab (was the Hook Coach page).
 *
 * Every reel is a story: HOOK -> CONTENT -> PAYOFF (long reels add re-hooks).
 * A collapsible "Your style" panel, stat cards, "check a reel before posting"
 * (upload), "turn an idea into a reel", and the post list (weakest first) with
 * Fix and Analyze. Results are saved: revisiting shows them without
 * regenerating; Redo replaces them (history stays in Saved).
 * Every action is at most two taps.
 */

import { useRef, useState, useSyncExternalStore } from "react";
import { gooeyToast } from "@/lib/hd-toast";
import {
  ArrowSquareOut,
  BookmarkSimple,
  CaretDown,
  Check,
  Clock,
  Eye,
  FilmSlate,
  ImageSquare,
  MagnifyingGlass,
  PaintBrush,
  Plus,
  ShareNetwork,
  Sparkle,
  SpinnerGap,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { HookData, HookPost } from "@/lib/server/hook-coach";
import {
  DEFAULT_REFERENCES,
  MAX_REFERENCES,
  type HookCoachProfileData,
  type StoryLength,
} from "@/lib/hook-coach-story";
import type { AnalyzeInput, FixResult, WriteResult } from "@/lib/coach/types";
import { useCoach } from "@/components/coach/context";
import { AnalyzeCard } from "@/components/coach/analyze-card";
import {
  FixResultView,
  SavedMeta,
  StoriesView,
} from "@/components/coach/story-card";

function ErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-destructive">
      <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <SpinnerGap className="size-4 animate-spin" />
      {label}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const pct = (v: number | null, digits = 0) =>
  v === null ? "—" : `${(v * 100).toFixed(digits)}%`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Instagram timestamps use "+0000"; make them strictly ISO for Date. */
function parseTimestamp(ts: string): Date {
  return new Date(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${suffix}`;
}

/**
 * Most common weekday and hour among the top quartile of posts by reach, in
 * the viewer's local time zone. Ties go to the bucket with more total reach.
 */
function bestTimeToPost(posts: HookPost[]): string | null {
  const withReach = posts
    .filter((p) => p.reach !== null)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  if (withReach.length < 4) return null;
  const top = withReach.slice(0, Math.max(2, Math.ceil(withReach.length / 4)));

  const pick = (key: (d: Date) => number) => {
    const buckets = new Map<number, { count: number; reach: number }>();
    for (const p of top) {
      const d = parseTimestamp(p.timestamp);
      if (Number.isNaN(d.getTime())) continue;
      const k = key(d);
      const b = buckets.get(k) ?? { count: 0, reach: 0 };
      b.count += 1;
      b.reach += p.reach ?? 0;
      buckets.set(k, b);
    }
    let best: number | null = null;
    let bestScore = { count: -1, reach: -1 };
    for (const [k, s] of buckets) {
      if (
        s.count > bestScore.count ||
        (s.count === bestScore.count && s.reach > bestScore.reach)
      ) {
        best = k;
        bestScore = s;
      }
    }
    return best;
  };

  const day = pick((d) => d.getDay());
  const hour = pick((d) => d.getHours());
  if (day === null || hour === null) return null;
  return `${DAYS[day]} · ${formatHour(hour)}`;
}

/** Weakest hook first: by 3s hold, then (shares+saves)/reach, then the rest. */
function sortWeakestFirst(posts: HookPost[]): HookPost[] {
  const rank = (p: HookPost) =>
    p.hold3s !== null ? 0 : p.spreadRate !== null ? 1 : 2;
  return [...posts].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.hold3s ?? 0) - (b.hold3s ?? 0);
    if (ra === 1) return (a.spreadRate ?? 0) - (b.spreadRate ?? 0);
    return 0;
  });
}

// Client-only flag without a setState-in-effect: false during SSR/hydration,
// true afterwards. Used so time-zone dependent output only renders client-side.
const subscribeNoop = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-tight text-muted-foreground">{label}</p>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-wash text-ink">
            {icon}
          </span>
        </div>
        <p className="font-display text-3xl leading-none tabular-nums text-foreground">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function LengthToggle({
  value,
  onChange,
}: {
  value: StoryLength;
  onChange: (v: StoryLength) => void;
}) {
  const options: Array<{ value: StoryLength; label: string; hint: string }> = [
    { value: "short", label: "Short", hint: "15–30s" },
    { value: "long", label: "Long", hint: "45–90s" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Reel length"
      className="hr2 inline-flex border-2 border-ink bg-wash p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "hr1 min-h-9 px-3 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-paper2 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
          <span className="ml-1 text-xs font-normal opacity-70">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

function StylePanel({
  initial,
  onSaved,
}: {
  initial: HookCoachProfileData;
  onSaved: (p: HookCoachProfileData) => void;
}) {
  const [open, setOpen] = useState(!initial.cta.trim());
  const [niche, setNiche] = useState(initial.niche);
  const [audience, setAudience] = useState(initial.audience);
  const [cta, setCta] = useState(initial.cta);
  const [refs, setRefs] = useState<string[]>(initial.references);
  const [newRef, setNewRef] = useState("");
  const [saving, setSaving] = useState(false);
  const usingDefaults =
    !initial.saved &&
    refs.length === DEFAULT_REFERENCES.length &&
    refs.every((r, i) => r === DEFAULT_REFERENCES[i]);

  function addRef() {
    const name = newRef.trim();
    if (!name) return;
    if (refs.length >= MAX_REFERENCES) {
      gooeyToast.error(`Up to ${MAX_REFERENCES} creators.`);
      return;
    }
    if (!refs.some((r) => r.toLowerCase() === name.toLowerCase())) {
      setRefs([...refs, name]);
    }
    setNewRef("");
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/hook-coach/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, audience, cta, references: refs }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        data?: HookCoachProfileData;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "Couldn't save your style.");
      }
      onSaved(json.data);
      setRefs(json.data.references);
      gooeyToast.success("Style saved");
      if (json.data.cta.trim()) setOpen(false);
    } catch (err) {
      gooeyToast.error(
        err instanceof Error ? err.message : "Couldn't save your style."
      );
    } finally {
      setSaving(false);
    }
  }

  const summary = initial.cta.trim()
    ? `CTA: ${initial.cta.trim()}`
    : "Add your CTA so every payoff ends with it";

  return (
    <Card size="sm">
      <CardContent className="gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-9 w-full items-center gap-2 text-left"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-wash text-ink">
            <PaintBrush weight="fill" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl leading-tight text-foreground">
              Your style
            </span>
            <span
              className={cn(
                "block truncate text-xs",
                initial.cta.trim() ? "text-muted-foreground" : "text-warning"
              )}
            >
              {summary}
            </span>
          </span>
          <CaretDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>

        {open && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Niche
                </span>
                <Input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. Personal finance for students"
                  maxLength={200}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Audience
                </span>
                <Input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  placeholder="e.g. 18–25, first job, India"
                  maxLength={300}
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Call to action (ends every payoff)
              </span>
              <Input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="e.g. Comment GUIDE and I'll DM you the template"
                maxLength={300}
              />
            </label>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Creators to learn from
                {usingDefaults && (
                  <span className="font-normal">
                    {" "}
                    · a starting list, edit it to fit your space
                  </span>
                )}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {refs.map((r) => (
                  <li key={r}>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pr-0.5 pl-2.5 text-xs text-foreground">
                      {r}
                      <button
                        type="button"
                        onClick={() => setRefs(refs.filter((x) => x !== r))}
                        aria-label={`Remove ${r}`}
                        className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRef();
                    }
                  }}
                  placeholder="Add a creator or @handle"
                  maxLength={80}
                  aria-label="Add a reference creator"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addRef}
                  disabled={!newRef.trim() || refs.length >= MAX_REFERENCES}
                  aria-label="Add creator"
                >
                  <Plus />
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={saving}
            >
              {saving ? <SpinnerGap className="animate-spin" /> : <Check />}
              Save style
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean | null;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 text-xs text-muted-foreground">
      {label}
      <span
        className={cn(
          "font-semibold tabular-nums",
          good === null
            ? "text-foreground"
            : good
              ? "text-success"
              : "text-destructive"
        )}
      >
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Check before posting (upload)                                       */
/* ------------------------------------------------------------------ */

function UploadCheck() {
  const coach = useCoach();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploads = coach.analyses
    .filter((a) => a.kind === "analyze" && a.mediaId === null)
    .slice(0, 2);
  const uploading = coach.busy.upload;
  const progress = coach.uploadProgress;

  return (
    <Card>
      <CardContent className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight text-foreground">
              Check a reel before posting
            </h2>
            <p className="text-xs text-muted-foreground">
              Upload the .mp4 or .mov (up to 200 MB). The coach watches all of it and scores it. Only you can see it.
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void coach.uploadAndAnalyze(file);
          }}
        />
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full sm:w-auto sm:self-start"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <SpinnerGap className="animate-spin" /> : <UploadSimple weight="bold" />}
          {uploading
            ? progress !== null
              ? `Uploading… ${Math.round(progress * 100)}%`
              : "Starting…"
            : "Upload a reel to check"}
        </Button>
        {uploading && progress !== null && (
          <div className="h-2 rounded-full border-[1.5px] border-ink bg-wash">
            <div
              className="h-full rounded-full bg-parrot transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
        <ErrorLine message={coach.errors.upload} />
        {uploads.map((a) => {
          const input = (a.input ?? {}) as AnalyzeInput;
          return (
            <div key={a.id} className="space-y-1.5">
              <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground">
                <FilmSlate className="size-3.5 shrink-0" />
                {input.fileName ?? "Uploaded video"}
              </p>
              <AnalyzeCard
                analysis={a}
                personas={coach.personas}
                redoing={coach.busy[`analyze:${input.uploadId}`]}
                onRedo={
                  input.uploadId
                    ? () => void coach.analyze({ uploadId: input.uploadId })
                    : undefined
                }
              />
              <ErrorLine message={coach.errors[`analyze:${input.uploadId}`]} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Idea -> stories                                                     */
/* ------------------------------------------------------------------ */

function WriteBox({ profile }: { profile: HookCoachProfileData }) {
  const coach = useCoach();
  const [idea, setIdea] = useState("");
  const [length, setLength] = useState<StoryLength>("short");
  const saved = coach.latest("write", null);
  const loading = coach.busy.write;
  const savedInput = (saved?.input ?? {}) as { idea?: string; length?: StoryLength };

  async function submit() {
    const trimmed = idea.trim();
    if (!trimmed || loading) return;
    const ok = await coach.write(trimmed, length);
    if (ok) setIdea("");
  }

  return (
    <Card>
      <CardContent className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="hook-idea"
            className="font-display text-2xl leading-tight text-foreground"
          >
            Turn an idea into a reel
          </label>
          <LengthToggle value={length} onChange={setLength} />
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Textarea
            id="hook-idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. Why I stopped doing morning workouts"
            rows={2}
            maxLength={1000}
            className="min-h-12 sm:flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button
            type="submit"
            size="lg"
            variant="hero"
            className="clicky w-full sm:w-auto"
            disabled={!idea.trim() || loading}
          >
            {loading ? <SpinnerGap className="animate-spin" /> : <Sparkle weight="fill" />}
            Write 3 stories
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Hook → content →{length === "long" ? " re-hook → content →" : ""} payoff
          {profile.cta.trim() ? ", ending on your CTA" : ""}.
        </p>
        {loading && <Loading label="Studying your best reels and writing 3 stories…" />}
        <ErrorLine message={coach.errors.write} />
        {saved && !loading && (
          <div className="space-y-2">
            <SavedMeta
              analysis={saved}
              personas={coach.personas}
              redoing={loading}
              onRedo={
                savedInput.idea
                  ? () => void coach.write(savedInput.idea!, savedInput.length ?? "short")
                  : undefined
              }
            />
            {savedInput.idea && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Idea: </span>
                {savedInput.idea}
              </p>
            )}
            <StoriesView stories={(saved.result as WriteResult)?.stories ?? []} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* One reel row                                                        */
/* ------------------------------------------------------------------ */

function ReelRow({
  post,
  avgHold,
  avgSpread,
}: {
  post: HookPost;
  avgHold: number | null;
  avgSpread: number | null;
}) {
  const coach = useCoach();
  const fix = coach.latest("fix", post.id);
  const analysis = coach.latest("analyze", post.id);
  const fixKey = `fix:${post.id}`;
  const analyzeKey = `analyze:${post.id}`;
  const fixing = coach.busy[fixKey];
  const analyzing = coach.busy[analyzeKey];
  const canAnalyze = post.isReel || post.mediaType === "VIDEO";
  const [open, setOpen] = useState(true);
  const hasSaved = Boolean(fix || analysis);

  const holdGood =
    post.hold3s === null || avgHold === null ? null : post.hold3s >= avgHold;
  const spreadGood =
    post.spreadRate === null || avgSpread === null ? null : post.spreadRate >= avgSpread;

  return (
    <li>
      <Card size="sm">
        <CardContent className="gap-3">
          <div className="flex items-start gap-3">
            <div className="hr2 relative size-14 shrink-0 overflow-hidden border-2 border-ink bg-muted">
              {post.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageSquare weight="fill" className="size-5" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-foreground wrap-break-word">
                {post.hook || <span className="italic text-muted-foreground">No caption</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Metric label="Hold" value={pct(post.hold3s)} good={holdGood} />
                <Metric label="Spread" value={pct(post.spreadRate, 1)} good={spreadGood} />
                {hasSaved && (
                  <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="hr1 inline-flex items-center gap-1 border-[1.5px] border-ink bg-parrot px-1.5 text-[11px] font-semibold text-ink"
                  >
                    <BookmarkSimple weight="fill" className="size-3" />
                    Saved
                    <CaretDown className={cn("size-3 transition-transform", open && "rotate-180")} />
                  </button>
                )}
                {post.permalink && (
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Open post on Instagram"
                  >
                    <ArrowSquareOut className="size-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {(!fix || !analysis) && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              {!fix && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={fixing}
                  onClick={() => void coach.fix(post.id)}
                  className={cn(!canAnalyze || analysis ? "col-span-2" : "")}
                >
                  {fixing ? <SpinnerGap className="animate-spin" /> : <Sparkle />}
                  {coach.errors[fixKey] ? "Try again" : "Fix this reel"}
                </Button>
              )}
              {canAnalyze && !analysis && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={analyzing}
                  onClick={() => void coach.analyze({ mediaId: post.id })}
                  className={cn(fix ? "col-span-2" : "")}
                >
                  {analyzing ? <SpinnerGap className="animate-spin" /> : <MagnifyingGlass />}
                  Analyze
                </Button>
              )}
            </div>
          )}

          {fixing && <Loading label="Finding where people dropped off…" />}
          <ErrorLine message={coach.errors[fixKey]} />
          <ErrorLine message={coach.errors[analyzeKey]} />

          {open && analysis && (
            <AnalyzeCard
              analysis={analysis}
              personas={coach.personas}
              redoing={analyzing}
              onRedo={() => void coach.analyze({ mediaId: post.id })}
            />
          )}
          {open && fix && !fixing && (
            <div className="space-y-2">
              <SavedMeta
                analysis={fix}
                personas={coach.personas}
                redoing={fixing}
                onRedo={() => void coach.fix(post.id)}
              />
              <FixResultView result={fix.result as FixResult} />
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

export default function ReelsTab({
  data,
  profile,
  onProfileSaved,
}: {
  data: HookData;
  profile: HookCoachProfileData;
  onProfileSaved: (p: HookCoachProfileData) => void;
}) {
  const isClient = useIsClient();
  const { posts, summary } = data;
  const sorted = sortWeakestFirst(posts);
  const bestTime = isClient ? bestTimeToPost(posts) : null;
  const hasAnyNumbers = posts.some((p) => p.hold3s !== null || p.spreadRate !== null);

  return (
    <div className="space-y-6">
      <StylePanel initial={profile} onSaved={onProfileSaved} />

      {(!data.insightsAvailable || data.permissionDenied) && (
        <Alert>
          <WarningCircle weight="fill" className="text-warning" />
          <AlertTitle>Instagram isn&apos;t sharing your numbers</AlertTitle>
          <AlertDescription>
            Hold and spread rates need the insights permission. Reconnect your
            account in Settings to grant it. You can still write stories, but
            they won&apos;t be based on what worked for you.
          </AlertDescription>
        </Alert>
      )}

      {data.insightsAvailable && summary.reelsWithHold === 0 && (
        <Alert>
          <WarningCircle weight="fill" />
          <AlertTitle>No 3-second hold data yet</AlertTitle>
          <AlertDescription>
            Instagram only reports skip rate for reels, and none of your recent
            reels have it yet. Posts are ranked by shares and saves instead.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <SummaryCard
          label="Avg 3-sec hold"
          value={pct(summary.avgHold3s)}
          hint={
            summary.reelsWithHold > 0
              ? `Across ${summary.reelsWithHold} reels`
              : "Needs reels with skip rate"
          }
          icon={<Eye weight="fill" className="size-4" />}
        />
        <SummaryCard
          label="Shares + saves per reach"
          value={pct(summary.avgSpreadRate, 1)}
          hint="How often people pass it on"
          icon={<ShareNetwork weight="fill" className="size-4" />}
        />
        <SummaryCard
          label="Best time to post"
          value={<span className="text-xl sm:text-2xl">{bestTime ?? "—"}</span>}
          hint={
            bestTime
              ? "From your own posts (your time zone)"
              : "From your own posts, once reach data comes in"
          }
          icon={<Clock weight="fill" className="size-4" />}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <UploadCheck />
      <WriteBox profile={profile} />

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-3xl leading-tight text-foreground">
            Your reels, weakest first
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasAnyNumbers
              ? "“Fix” rewrites it as a story. “Analyze” watches the whole video and breaks it down second by second."
              : "Instagram hasn't shared numbers for these posts yet, so they're in posting order."}
          </p>
        </div>
        <ul className="space-y-3">
          {sorted.map((post) => (
            <ReelRow
              key={post.id}
              post={post}
              avgHold={summary.avgHold3s}
              avgSpread={summary.avgSpreadRate}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
