"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Plus, Sparkle, UploadSimple, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatWhen } from "@/components/schedule-form";
import { api, PersonaSelect, ReelPicker } from "@/components/strategy/strategy-shared";
import { sfx } from "@/lib/handdrawn";
import { gooeyToast } from "@/lib/hd-toast";
import { captionProblem, fileExtension, isAllowedExtension, MAX_VIDEO_BYTES } from "@/lib/scheduling/rules";
import { toLocalInputValue } from "@/lib/scheduling/suggest";
import { uploadVideo } from "@/lib/scheduling/upload-client";
import { HOOK_POSITION_DEFAULT, MAX_HOOK_CHARS, MAX_VARIANTS, MIN_VARIANTS, VARIANT_LABELS, VARIANT_STAGGER_MIN } from "@/lib/strategy/config";
import type { StrategyData } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

type Variable = "hook" | "first_frame";
interface HookRow {
  text: string;
  angle: string;
  on: boolean;
}
type Upload = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "done"; uploadId: string; name: string } | { kind: "error"; message: string };

export function HookTestFlow({
  data,
  initialMediaId,
  initialVariable,
  onCreated,
}: {
  data: StrategyData;
  initialMediaId: string | null;
  initialVariable?: Variable;
  onCreated: () => Promise<void> | void;
}) {
  const [sourceKind, setSourceKind] = useState<"reel" | "upload">(initialMediaId || data.reels.length ? "reel" : "upload");
  const [mediaId, setMediaId] = useState<string | null>(initialMediaId);
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const [variable, setVariable] = useState<Variable>(initialVariable ?? "hook");
  const [idea, setIdea] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [writing, setWriting] = useState(false);
  const [ownHook, setOwnHook] = useState("");
  const [sharedHook, setSharedHook] = useState("");
  const [trims, setTrims] = useState<number[]>([0, 1, 2]);
  const [previews, setPreviews] = useState<Array<{ image: string | null; error: string | null }>>([]);
  const [previewing, setPreviewing] = useState(false);
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState(() => toLocalInputValue(new Date(data.nextTestSlot)));
  const [shareToFeed, setShareToFeed] = useState(true);
  const [hookPosition, setHookPosition] = useState<"top" | "middle">(HOOK_POSITION_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const source = sourceKind === "reel" ? (mediaId ? { mediaId } : null) : upload.kind === "done" ? { uploadId: upload.uploadId } : null;
  const reel = data.reels.find((r) => r.id === mediaId) ?? null;

  const variants =
    variable === "hook"
      ? hooks.filter((h) => h.on && h.text.trim()).map((h) => ({ hook: h.text.trim(), trimStartSec: 0 }))
      : trims.map((t) => ({ hook: sharedHook.trim() || null, trimStartSec: t }));
  const count = variants.length;
  const whenDate = when ? new Date(when) : null;
  const capProblem = captionProblem(caption);
  const ready = !!source && count >= MIN_VARIANTS && count <= MAX_VARIANTS && !!whenDate && !capProblem && !submitting;

  // Previews go stale when the variants change.
  const key = JSON.stringify([source, variants, hookPosition]);
  const [previewKey, setPreviewKey] = useState("");
  const previewsFresh = previewKey === key;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (!isAllowedExtension(fileExtension(file.name)) || file.size > MAX_VIDEO_BYTES) {
      gooeyToast.error("Pick an MP4 or MOV video up to 300 MB.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ kind: "uploading", progress: 0 });
    try {
      const res = await uploadVideo(file, (p) => setUpload({ kind: "uploading", progress: p }), controller.signal);
      setUpload({ kind: "done", uploadId: res.uploadId, name: file.name });
    } catch (err) {
      if (controller.signal.aborted) return;
      setUpload({ kind: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  async function writeHooks() {
    setWriting(true);
    const res = await api<{ hooks: Array<{ text: string; angle: string }> }>("/api/strategy/hooks", {
      method: "POST",
      json: {
        mode: "test",
        count: MAX_VARIANTS,
        mediaId: sourceKind === "reel" ? mediaId : null,
        idea: idea || null,
        personaId: personaId || null,
        avoid: reel?.hook ? [reel.hook] : [],
      },
    });
    setWriting(false);
    if (!res) return;
    sfx("pop");
    setHooks(res.hooks.map((h) => ({ text: h.text, angle: h.angle, on: true })).slice(0, MAX_VARIANTS));
  }

  async function preview() {
    if (!source || count === 0) return;
    setPreviewing(true);
    const res = await api<{ previews: Array<{ image: string | null; error: string | null }> }>("/api/strategy/preview", {
      method: "POST",
      json: { source, variants, hookPosition },
    });
    setPreviewing(false);
    if (res) {
      setPreviews(res.previews);
      setPreviewKey(key);
    }
  }

  async function submit() {
    if (!ready || !source || !whenDate) return;
    setSubmitting(true);
    const res = await api<{ id: string; startAt: string }>("/api/strategy/experiments", {
      method: "POST",
      json: {
        kind: "ab_test",
        source,
        variable,
        caption,
        shareToFeed,
        scheduledAt: whenDate.toISOString(),
        hookPosition,
        variants,
      },
    });
    setSubmitting(false);
    if (!res) return;
    sfx("yes");
    gooeyToast.success(`${count} trial reels from ${formatWhen(new Date(res.startAt))}, ${VARIANT_STAGGER_MIN} min apart`);
    await onCreated();
  }

  const selectedCount = hooks.filter((h) => h.on).length;

  return (
    <div className="hr1 space-y-5 border-[2.5px] border-ink bg-card p-4 sm:p-5">
      <div>
        <p className="font-display text-2xl leading-none">Test up to {MAX_VARIANTS} hooks</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Each variant goes out as a trial reel (non-followers only, you decide what to share), {VARIANT_STAGGER_MIN} min apart.
        </p>
      </div>

      {/* 1. Video */}
      <section className="space-y-2">
        <Segmented
          value={sourceKind}
          onChange={(v) => setSourceKind(v as "reel" | "upload")}
          options={[
            ["reel", "One of my reels"],
            ["upload", "Upload a video"],
          ]}
        />
        {sourceKind === "reel" ? (
          <ReelPicker reels={data.reels} selected={mediaId} onSelect={setMediaId} />
        ) : (
          <UploadBox upload={upload} onPick={pickFile} onClear={() => setUpload({ kind: "idle" })} id="test-video" />
        )}
      </section>

      {/* 2. What to test */}
      <section className="space-y-3">
        <Segmented
          value={variable}
          onChange={(v) => setVariable(v as Variable)}
          options={[
            ["hook", "Different hooks"],
            ["first_frame", "Different first frame"],
          ]}
        />
        {variable === "hook" ? (
          <>
            {sourceKind === "upload" ? (
              <label className="block">
                <span className="text-sm font-semibold">What&apos;s the video about?</span>
                <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={2} className="mt-1.5 text-base" placeholder="One line is enough" />
              </label>
            ) : null}
            <PersonaSelect value={personaId} onChange={setPersonaId} />
            <Button type="button" variant="hero" className="clicky h-11 w-full text-base" disabled={writing || (sourceKind === "reel" && !mediaId)} onClick={writeHooks}>
              <Sparkle /> {writing ? "Writing hooks…" : hooks.length ? "Write new hooks" : `Write ${MAX_VARIANTS} hooks with Coach`}
            </Button>
            {hooks.length > 0 ? (
              <ul className="space-y-2" aria-label="Hooks">
                {hooks.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Use hook ${i + 1}`}
                      checked={h.on}
                      disabled={!h.on && selectedCount >= MAX_VARIANTS}
                      onChange={(e) => setHooks((xs) => xs.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                      className="mt-3 size-5 accent-(--hd-accent)"
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        value={h.text}
                        maxLength={MAX_HOOK_CHARS}
                        onChange={(e) => setHooks((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                        className="hr3 h-11 w-full border-2 border-ink bg-paper px-3 text-base"
                      />
                      {h.angle ? <p className="text-[11px] text-muted-foreground">{h.angle}</p> : null}
                    </div>
                    <button type="button" aria-label="Remove hook" className="grid size-11 place-items-center" onClick={() => setHooks((xs) => xs.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <input
                value={ownHook}
                maxLength={MAX_HOOK_CHARS}
                onChange={(e) => setOwnHook(e.target.value)}
                placeholder="Or type your own hook"
                className="hr3 h-11 min-w-0 flex-1 border-2 border-ink bg-paper px-3 text-base"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (ownHook.trim()) {
                      setHooks((xs) => [...xs, { text: ownHook.trim(), angle: "", on: selectedCount < MAX_VARIANTS }]);
                      setOwnHook("");
                    }
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="clicky h-11"
                aria-label="Add hook"
                disabled={!ownHook.trim()}
                onClick={() => {
                  setHooks((xs) => [...xs, { text: ownHook.trim(), angle: "", on: selectedCount < MAX_VARIANTS }]);
                  setOwnHook("");
                }}
              >
                <Plus />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedCount}/{MAX_VARIANTS} picked{selectedCount < MIN_VARIANTS ? ` · pick at least ${MIN_VARIANTS}` : ""}
            </p>
          </>
        ) : (
          <>
            <label className="block">
              <span className="text-sm font-semibold">Hook text on all variants (optional)</span>
              <input value={sharedHook} maxLength={MAX_HOOK_CHARS} onChange={(e) => setSharedHook(e.target.value)} className="hr3 mt-1.5 h-11 w-full border-2 border-ink bg-paper px-3 text-base" />
            </label>
            <p className="text-sm font-semibold">Start each variant at</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {trims.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="font-display text-lg">{VARIANT_LABELS[i]}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={t}
                    aria-label={`Variant ${VARIANT_LABELS[i]} starts at (seconds)`}
                    onChange={(e) => setTrims((xs) => xs.map((x, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : x)))}
                    className="hr3 h-11 w-20 border-2 border-ink bg-paper px-2 text-base"
                  />
                  <span className="text-xs text-muted-foreground">s</span>
                  {trims.length > MIN_VARIANTS ? (
                    <button type="button" aria-label="Remove variant" className="grid size-9 place-items-center" onClick={() => setTrims((xs) => xs.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {trims.length < MAX_VARIANTS ? (
              <Button type="button" variant="outline" size="sm" className="clicky h-10" onClick={() => setTrims((xs) => [...xs, (xs.at(-1) ?? 0) + 1])}>
                <Plus /> Add a variant
              </Button>
            ) : null}
          </>
        )}
      </section>

      {/* 3. Preview */}
      {source && count > 0 ? (
        <section className="space-y-2">
          <HookPositionPicker value={hookPosition} onChange={setHookPosition} />
          <Button type="button" variant="outline" className="clicky h-11 w-full text-base" disabled={previewing} onClick={preview}>
            <Eye /> {previewing ? "Drawing first frames…" : previewsFresh ? "Previews up to date" : "Preview first frames"}
          </Button>
          {previews.length > 0 && previewsFresh ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {previews.map((p, i) => (
                <li key={i} className="hr2 overflow-hidden border-2 border-ink bg-paper2">
                  <p className="px-1.5 py-0.5 font-display text-base leading-none">{VARIANT_LABELS[i]}</p>
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt={`Variant ${VARIANT_LABELS[i]} first frame`} className="aspect-9/16 w-full object-cover" />
                  ) : (
                    <p className="p-2 text-xs text-destructive">{p.error}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* 4. Caption + time */}
      <section className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">Caption (same on every variant)</span>
          <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className="mt-1.5 text-base" aria-invalid={capProblem ? true : undefined} />
          {capProblem ? <span className="text-xs text-destructive">{capProblem}</span> : null}
        </label>
        <label className="block">
          <span className="text-sm font-semibold">First variant goes out</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="hr3 mt-1.5 h-12 w-full border-2 border-ink bg-paper px-3 text-base" />
          <span className="mt-1 block text-xs text-muted-foreground">
            Suggested: {formatWhen(new Date(data.nextTestSlot))} (your best slot). {data.testBatchesThisWeek}/{data.limits.maxBatchesPerWeek} tests this week.
          </span>
        </label>
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-semibold">Also share to feed</span>
          <Switch checked={shareToFeed} onCheckedChange={(v) => setShareToFeed(v)} />
        </label>
      </section>

      <Button type="button" variant="hero" disabled={!ready} onClick={submit} className="clicky h-12 w-full text-xl">
        {submitting ? "Starting…" : count >= MIN_VARIANTS ? `Schedule ${count} trial reels` : `Pick ${MIN_VARIANTS}–${MAX_VARIANTS} variants`}
      </Button>
    </div>
  );
}

export function HookPositionPicker({ value, onChange }: { value: "top" | "middle"; onChange: (v: "top" | "middle") => void }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">Hook text position</p>
      <Segmented
        value={value}
        onChange={(v) => onChange(v as "top" | "middle")}
        options={[
          ["top", "Top"],
          ["middle", "Middle"],
        ]}
      />
      <p className="text-[11px] text-muted-foreground">Middle keeps a title already burned in at the top readable.</p>
    </div>
  );
}

export function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("hr3 clicky min-h-11 border-2 px-2 text-sm font-semibold", value === v ? "border-ink bg-ink text-paper" : "border-ink/40 bg-paper")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function UploadBox({ upload, onPick, onClear, id }: { upload: Upload; onPick: (f: File | undefined) => void; onClear: () => void; id: string }) {
  return (
    <div>
      <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" id={id} onChange={(e) => onPick(e.target.files?.[0])} />
      {upload.kind === "idle" || upload.kind === "error" ? (
        <label htmlFor={id} className="hr2 clicky flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-ink/60 bg-paper2 p-4 text-center">
          <UploadSimple size={28} />
          <span className="font-display text-lg">Pick a video</span>
          {upload.kind === "error" ? <span className="text-xs text-destructive">{upload.message}</span> : null}
        </label>
      ) : upload.kind === "uploading" ? (
        <div className="hr1 h-3 overflow-hidden border-2 border-ink bg-paper" role="progressbar" aria-valuenow={Math.round(upload.progress * 100)}>
          <div className="h-full bg-ok" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
        </div>
      ) : (
        <p className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-semibold text-ok">Uploaded ✓ {upload.name}</span>
          <button type="button" className="grid size-10 place-items-center" aria-label="Remove video" onClick={onClear}>
            <X />
          </button>
        </p>
      )}
    </div>
  );
}

export type { Upload };
