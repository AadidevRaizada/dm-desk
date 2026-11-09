"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FilmStrip, UploadSimple, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { sfx } from "@/lib/handdrawn";
import { gooeyToast } from "@/lib/hd-toast";
import {
  captionLength,
  captionProblem,
  countHashtags,
  durationProblem,
  fileExtension,
  isAllowedExtension,
  MAX_CAPTION_CHARS,
  MAX_HASHTAGS,
  MAX_VIDEO_BYTES,
} from "@/lib/scheduling/rules";
import { suggestSlot, toLocalInputValue } from "@/lib/scheduling/suggest";
import { uploadVideo } from "@/lib/scheduling/upload-client";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};
function useIsClient() {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

/** Wall clock that ticks every `intervalMs` (keeps render pure). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "done"; uploadId: string }
  | { kind: "error"; message: string };

export function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ScheduleForm({
  accounts,
  topPostTimestamps,
  onScheduled,
}: {
  accounts: { id: string; username: string }[];
  topPostTimestamps: string[];
  onScheduled: () => Promise<void> | void;
}) {
  const isClient = useIsClient();
  const now = useNow();
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState(""); // "" = use the suggested slot
  const [shareToFeed, setShareToFeed] = useState(true);
  const [trial, setTrial] = useState(false);
  const [trialStrategy, setTrialStrategy] = useState<"SS_PERFORMANCE" | "MANUAL">("SS_PERFORMANCE");
  const [coverSec, setCoverSec] = useState(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Free the preview blob when it changes or the form goes away.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const suggestion = isClient ? suggestSlot(topPostTimestamps, new Date(now)) : null;
  const whenValue = when || (suggestion ? toLocalInputValue(suggestion.at) : "");

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setDuration(0);
    setUpload({ kind: "idle" });
    setCaption("");
    setWhen("");
    setCoverSec(0);
    setShareToFeed(true);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function pick(next: File | undefined) {
    if (!next) return;
    if (!isAllowedExtension(fileExtension(next.name))) {
      gooeyToast.error("Pick an MP4 or MOV video.");
      return;
    }
    if (next.size > MAX_VIDEO_BYTES) {
      gooeyToast.error("Videos can be 300 MB at most.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setDuration(0);
    setCoverSec(0);
    setUpload({ kind: "uploading", progress: 0 });
    try {
      const result = await uploadVideo(
        next,
        (p) => setUpload({ kind: "uploading", progress: p }),
        controller.signal
      );
      if (controller.signal.aborted) return;
      if (result.probe?.durationSec) setDuration(result.probe.durationSec);
      setUpload({ kind: "done", uploadId: result.uploadId });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Upload failed.";
      setUpload({ kind: "error", message });
      gooeyToast.error(message);
    }
  }

  function onMetadata() {
    const d = videoRef.current?.duration ?? 0;
    if (!Number.isFinite(d) || d <= 0) return;
    setDuration(d);
    const problem = durationProblem(d);
    if (problem) {
      abortRef.current?.abort();
      setUpload({ kind: "error", message: problem });
      gooeyToast.error(problem);
    }
  }

  function moveCover(sec: number) {
    setCoverSec(sec);
    if (videoRef.current) videoRef.current.currentTime = sec;
  }

  const capLen = captionLength(caption);
  const tags = countHashtags(caption);
  const capProblem = captionProblem(caption);
  const whenDate = whenValue ? new Date(whenValue) : null;
  const whenInPast = whenDate ? whenDate.getTime() < now - 60_000 : false;
  const ready =
    upload.kind === "done" && !capProblem && !!whenDate && !whenInPast && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (upload.kind !== "done" || !whenDate) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: upload.uploadId,
          instagramAccountId: accountId || null,
          caption,
          scheduledAt: whenDate.toISOString(),
          shareToFeed,
          trialStrategy: trial ? trialStrategy : null,
          thumbOffsetMs: Math.round(coverSec * 1000),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not schedule it.");
      sfx("yes");
      gooeyToast.success(`Scheduled for ${formatWhen(whenDate)}`);
      reset();
      await onScheduled();
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : "Could not schedule it.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="hr1 space-y-5 border-[2.5px] border-ink bg-card p-4 sm:p-5"
    >
      <p className="font-display text-2xl leading-none">New reel</p>

      {/* 1. Video */}
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="sr-only"
        id="schedule-video"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {!file ? (
        <label
          htmlFor="schedule-video"
          className="hr2 clicky flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-ink/60 bg-paper2 p-6 text-center"
        >
          <UploadSimple size={32} />
          <span className="font-display text-xl">Pick a video</span>
          <span className="text-xs text-muted-foreground">
            MP4 or MOV · 3 s to 15 min · up to 300 MB
          </span>
        </label>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3">
            {previewUrl ? (
              <video
                ref={videoRef}
                src={previewUrl}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={onMetadata}
                className="hr2 aspect-9/16 w-28 shrink-0 border-2 border-ink bg-ink object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <FilmStrip className="size-4 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove video"
                  onClick={reset}
                >
                  <X />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB
                {duration ? ` · ${formatDuration(duration)}` : ""}
              </p>
              {upload.kind === "uploading" ? (
                <div>
                  <div
                    className="hr1 h-3 overflow-hidden border-2 border-ink bg-paper"
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuenow={Math.round(upload.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full bg-ok transition-[width]"
                      style={{ width: `${Math.round(upload.progress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {upload.progress >= 1
                      ? "Checking the video…"
                      : `Uploading ${Math.round(upload.progress * 100)}%`}
                  </p>
                </div>
              ) : upload.kind === "done" ? (
                <p className="text-xs font-semibold text-ok">Uploaded ✓</p>
              ) : upload.kind === "error" ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-destructive">{upload.message}</p>
                  <label htmlFor="schedule-video" className="cursor-pointer text-xs underline">
                    Pick another
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          {duration > 0 ? (
            <div>
              <label htmlFor="schedule-cover" className="text-sm font-semibold">
                Cover frame{" "}
                <span className="font-normal text-muted-foreground">
                  at {coverSec.toFixed(1)} s
                </span>
              </label>
              <input
                id="schedule-cover"
                type="range"
                min={0}
                max={Math.max(0, duration - 0.1)}
                step={0.1}
                value={coverSec}
                onChange={(e) => moveCover(Number(e.target.value))}
                className="mt-2 h-8 w-full accent-(--hd-accent)"
              />
            </div>
          ) : null}
        </div>
      )}

      {/* 2. Caption */}
      <div>
        <label htmlFor="schedule-caption" className="text-sm font-semibold">
          Caption
        </label>
        <Textarea
          id="schedule-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Hook line, then the CTA. #hashtags at the end."
          rows={5}
          className="mt-1.5 min-h-28 text-base"
          aria-invalid={capProblem ? true : undefined}
        />
        <p
          className={cn(
            "mt-1 flex justify-between text-xs tabular-nums",
            capProblem ? "text-destructive" : "text-muted-foreground"
          )}
        >
          <span>{capProblem ?? " "}</span>
          <span>
            {capLen}/{MAX_CAPTION_CHARS} · {tags}/{MAX_HASHTAGS} #
          </span>
        </p>
      </div>

      {/* 3. When */}
      <div>
        <label htmlFor="schedule-when" className="text-sm font-semibold">
          When
        </label>
        <input
          id="schedule-when"
          type="datetime-local"
          value={whenValue}
          min={isClient ? toLocalInputValue(new Date(now)) : undefined}
          onChange={(e) => setWhen(e.target.value)}
          className="hr3 mt-1.5 h-12 w-full border-2 border-ink bg-paper px-3 text-base"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {whenInPast
            ? "That time has passed. Pick a later one."
            : suggestion && !when
              ? suggestion.reason === "top-posts"
                ? "Suggested: the hour your top posts went out."
                : "Suggested: tomorrow at 7 pm."
              : suggestion
                ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setWhen("")}
                    >
                      Use suggested ({formatWhen(suggestion.at)})
                    </button>
                  )
                : null}
        </p>
      </div>

      {/* 4. Options */}
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>
          <span className="text-sm font-semibold">Also share to feed</span>
          <span className="block text-xs text-muted-foreground">
            Off = it only shows in the Reels tab.
          </span>
        </span>
        <Switch checked={shareToFeed} onCheckedChange={(v) => setShareToFeed(v)} />
      </label>

      <div>
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span>
            <span className="text-sm font-semibold">Trial reel</span>
            <span className="block text-xs text-muted-foreground">
              Shown to non-followers first, so a miss doesn&apos;t hit your followers.
            </span>
          </span>
          <Switch checked={trial} onCheckedChange={(v) => setTrial(v)} />
        </label>
        {trial ? (
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="When followers see it">
            {([
              ["SS_PERFORMANCE", "Share if it does well", "Instagram decides"],
              ["MANUAL", "I'll decide", "In the Instagram app"],
            ] as const).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={trialStrategy === value}
                onClick={() => setTrialStrategy(value)}
                className={
                  "rounded-md border-2 px-3 py-2 text-left " +
                  (trialStrategy === value ? "border-foreground bg-muted" : "border-border")
                }
              >
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {accounts.length > 1 ? (
        <div>
          <label htmlFor="schedule-account" className="text-sm font-semibold">
            Account
          </label>
          <select
            id="schedule-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="hr3 mt-1.5 h-12 w-full border-2 border-ink bg-paper px-3 text-base"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <Button
        type="submit"
        variant="hero"
        disabled={!ready}
        className="clicky h-12 w-full text-xl"
      >
        {submitting
          ? "Scheduling…"
          : upload.kind === "uploading"
            ? "Uploading…"
            : whenDate && !whenInPast
              ? `Schedule for ${formatWhen(whenDate)}`
              : "Schedule reel"}
      </Button>
    </form>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
