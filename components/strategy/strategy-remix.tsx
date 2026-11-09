"use client";

import { useState } from "react";
import { Eye, Sparkle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatWhen, useNow } from "@/components/schedule-form";
import { HookPositionPicker } from "@/components/strategy/strategy-hook-test";
import { api, PersonaSelect, ReelPicker } from "@/components/strategy/strategy-shared";
import { sfx } from "@/lib/handdrawn";
import { gooeyToast } from "@/lib/hd-toast";
import { captionProblem } from "@/lib/scheduling/rules";
import { toLocalInputValue } from "@/lib/scheduling/suggest";
import {
  DAY_MS,
  HOOK_POSITION_DEFAULT,
  MAX_HOOK_CHARS,
  REPOST_DEFAULT_GAP_DAYS,
  REPOST_DEFAULT_TRIM_SEC,
  REPOST_MIN_GAP_DAYS,
  REPOST_TRIAL_BY_DEFAULT,
} from "@/lib/strategy/config";
import type { StrategyData } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

/**
 * Remix & repost: pick an old reel, Coach writes new hooks + a new caption,
 * the server re-edits it (new burned-in hook, tighter start, new cover).
 */
export function RemixFlow({
  data,
  initialMediaId,
  onCreated,
}: {
  data: StrategyData;
  initialMediaId: string | null;
  onCreated: () => Promise<void> | void;
}) {
  const ordered = [...data.reels].sort(
    (a, b) => Number(b.repostable) - Number(a.repostable) || a.timestamp.localeCompare(b.timestamp)
  );
  const [mediaId, setMediaId] = useState<string | null>(initialMediaId ?? ordered.find((r) => r.repostable)?.id ?? null);
  const [personaId, setPersonaId] = useState("");
  const [hooks, setHooks] = useState<string[]>([]);
  const [hook, setHook] = useState("");
  const [caption, setCaption] = useState("");
  const [writing, setWriting] = useState(false);
  const [trim, setTrim] = useState(REPOST_DEFAULT_TRIM_SEC);
  const [trial, setTrial] = useState(REPOST_TRIAL_BY_DEFAULT);
  const [when, setWhen] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [hookPosition, setHookPosition] = useState<"top" | "middle">(HOOK_POSITION_DEFAULT);
  const [submitting, setSubmitting] = useState(false);

  const now = useNow();
  const reel = data.reels.find((r) => r.id === mediaId) ?? null;
  const posted = reel ? Date.parse(reel.timestamp) : 0;
  const minAt = posted + REPOST_MIN_GAP_DAYS * DAY_MS;
  const defaultAt = Math.max(now, posted + REPOST_DEFAULT_GAP_DAYS * DAY_MS);
  const whenDate = when ? new Date(when) : null;
  const whenTooSoon = whenDate ? whenDate.getTime() < minAt : false;
  const capProblem = captionProblem(caption);
  const ready = !!reel && !!hook.trim() && !!caption.trim() && !capProblem && !whenTooSoon && !submitting;

  async function write(id: string) {
    setWriting(true);
    const r = data.reels.find((x) => x.id === id);
    const res = await api<{ hooks: Array<{ text: string }>; caption: string | null }>("/api/strategy/hooks", {
      method: "POST",
      json: { mode: "repost", count: 3, mediaId: id, personaId: personaId || null, avoid: r?.hook ? [r.hook] : [] },
    });
    setWriting(false);
    if (!res) return;
    sfx("pop");
    setHooks(res.hooks.map((h) => h.text));
    setHook(res.hooks[0]?.text ?? "");
    if (res.caption) setCaption(res.caption);
  }

  // Changing the reel clears the copy for the old one.
  function selectReel(id: string) {
    if (id === mediaId) return;
    setMediaId(id);
    setHooks([]);
    setHook("");
    setCaption("");
    setPreview(null);
    setWhen("");
  }

  async function doPreview() {
    if (!mediaId || !hook.trim()) return;
    setPreviewing(true);
    const res = await api<{ previews: Array<{ image: string | null; error: string | null }> }>("/api/strategy/preview", {
      method: "POST",
      json: { source: { mediaId }, hookPosition, variants: [{ hook, trimStartSec: trim }] },
    });
    setPreviewing(false);
    const p = res?.previews[0];
    if (p?.image) setPreview(p.image);
    else if (p?.error) gooeyToast.error(p.error);
  }

  async function submit() {
    if (!ready || !mediaId) return;
    setSubmitting(true);
    const res = await api<{ startAt: string }>("/api/strategy/experiments", {
      method: "POST",
      json: {
        kind: "repost",
        mediaId,
        hook: hook.trim(),
        caption,
        trimStartSec: trim,
        trial,
        hookPosition,
        scheduledAt: whenDate ? whenDate.toISOString() : null,
      },
    });
    setSubmitting(false);
    if (!res) return;
    sfx("yes");
    gooeyToast.success(`Remix scheduled for ${formatWhen(new Date(res.startAt))}`);
    await onCreated();
  }

  return (
    <div className="hr2 space-y-5 border-[2.5px] border-ink bg-card p-4 sm:p-5">
      <div>
        <p className="font-display text-2xl leading-none">Remix &amp; repost</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A real re-edit, never a copy: new hook burned into the first 3 s, a tighter start, a new cover and a new caption. Goes out {REPOST_DEFAULT_GAP_DAYS}+ days after the original.
        </p>
      </div>

      <section className="space-y-2">
        <p className="text-sm font-semibold">Pick a reel</p>
        <ReelPicker
          reels={ordered}
          selected={mediaId}
          onSelect={selectReel}
          note={(r) => (r.repostable ? "★ top performer" : null)}
        />
        {reel?.repostReason ? <p className="text-xs text-muted-foreground">{reel.repostReason}</p> : null}
      </section>

      {reel ? (
        <>
          <section className="space-y-3">
            <PersonaSelect value={personaId} onChange={setPersonaId} />
            <Button type="button" variant="hero" className="clicky h-11 w-full text-base" disabled={writing} onClick={() => mediaId && write(mediaId)}>
              <Sparkle /> {writing ? "Writing…" : hooks.length ? "Write again" : "Write a new hook + caption"}
            </Button>
            {hooks.length > 0 ? (
              <div className="space-y-1.5" role="radiogroup" aria-label="New hook">
                {hooks.map((h) => (
                  <button
                    key={h}
                    type="button"
                    role="radio"
                    aria-checked={hook === h}
                    onClick={() => setHook(h)}
                    className={cn("hr3 block min-h-11 w-full border-2 px-3 py-2 text-left text-sm", hook === h ? "border-ink bg-ink text-paper" : "border-ink/40 bg-paper")}
                  >
                    {h}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="block">
              <span className="text-sm font-semibold">New hook (on screen)</span>
              <input value={hook} maxLength={MAX_HOOK_CHARS} onChange={(e) => setHook(e.target.value)} className="hr3 mt-1.5 h-11 w-full border-2 border-ink bg-paper px-3 text-base" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Cut from the start: {trim.toFixed(1)} s</span>
              <input type="range" min={0.3} max={3} step={0.1} value={trim} onChange={(e) => setTrim(Number(e.target.value))} className="mt-2 h-8 w-full accent-(--hd-accent)" />
            </label>
            <HookPositionPicker
              value={hookPosition}
              onChange={(v) => {
                setHookPosition(v);
                setPreview(null);
              }}
            />
            <Button type="button" variant="outline" className="clicky h-11 w-full text-base" disabled={previewing || !hook.trim()} onClick={doPreview}>
              <Eye /> {previewing ? "Drawing…" : "Preview first frame"}
            </Button>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Remix first frame" className="hr1 mx-auto aspect-9/16 w-40 border-2 border-ink object-cover" />
            ) : null}
            <label className="block">
              <span className="text-sm font-semibold">New caption</span>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} className="mt-1.5 text-base" aria-invalid={capProblem ? true : undefined} />
              {capProblem ? <span className="text-xs text-destructive">{capProblem}</span> : null}
            </label>
          </section>

          <section className="space-y-3">
            <label className="flex min-h-11 items-center justify-between gap-3">
              <span>
                <span className="text-sm font-semibold">Post as a trial reel</span>
                <span className="block text-xs text-muted-foreground">
                  {trial ? "Non-followers first; you share it if it does well." : "Goes to followers and counts toward your 3 a week."}
                </span>
              </span>
              <Switch checked={trial} onCheckedChange={(v) => setTrial(v)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">When</span>
              <input
                type="datetime-local"
                value={when}
                min={toLocalInputValue(new Date(Math.max(now, minAt)))}
                onChange={(e) => setWhen(e.target.value)}
                className="hr3 mt-1.5 h-12 w-full border-2 border-ink bg-paper px-3 text-base"
              />
              <span className={cn("mt-1 block text-xs", whenTooSoon ? "text-destructive" : "text-muted-foreground")}>
                {whenTooSoon
                  ? `At least ${REPOST_MIN_GAP_DAYS} days after the original (from ${formatWhen(new Date(minAt))}).`
                  : when
                    ? ""
                    : `Empty = your best slot after ${formatWhen(new Date(defaultAt))}.`}
              </span>
            </label>
          </section>

          <Button type="button" variant="hero" disabled={!ready} onClick={submit} className="clicky h-12 w-full text-xl">
            {submitting ? "Starting…" : "Schedule the remix"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
