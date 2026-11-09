"use client";

import { useEffect, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { gooeyToast } from "@/lib/hd-toast";
import type { ExperimentStatus } from "@/lib/strategy/config";
import type { ReelOption } from "@/lib/strategy/types";
import { cn } from "@/lib/utils";

/** JSON fetch with a toast on failure; returns null when it failed. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      gooeyToast.error(body.error ?? "That didn't work.");
      return null;
    }
    return body;
  } catch {
    gooeyToast.error("No connection. Try again.");
    return null;
  }
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`;

export function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS: Record<ExperimentStatus, { label: string; tone: string }> = {
  draft: { label: "Rendering", tone: "bg-paper2" },
  scheduled: { label: "Scheduled", tone: "bg-paper2" },
  running: { label: "Collecting numbers", tone: "bg-wash" },
  deciding: { label: "Deciding", tone: "bg-wash" },
  decided: { label: "Winner", tone: "bg-ok/25" },
  no_winner: { label: "No clear winner", tone: "bg-warning/25" },
  cancelled: { label: "Cancelled", tone: "bg-muted" },
};

export function ExperimentBadge({ status, progress }: { status: ExperimentStatus; progress?: { done: number; total: number } | null }) {
  const s = STATUS[status];
  return (
    <span className={cn("hr3 inline-flex items-center border-2 border-ink px-2 py-0.5 text-xs font-semibold", s.tone)}>
      {s.label}
      {status === "draft" && progress ? ` ${progress.done}/${progress.total}` : ""}
    </span>
  );
}

/** Horizontal strip of his reels; tap one to pick it. */
export function ReelPicker({
  reels,
  selected,
  onSelect,
  note,
}: {
  reels: ReelOption[];
  selected: string | null;
  onSelect: (id: string) => void;
  note?: (r: ReelOption) => string | null;
}) {
  if (reels.length === 0) {
    return <p className="text-sm text-muted-foreground">No reels with numbers yet.</p>;
  }
  return (
    <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2" aria-label="Your reels">
      {reels.map((r) => {
        const on = r.id === selected;
        const extra = note?.(r);
        return (
          <li key={r.id} className="w-28 shrink-0 snap-start">
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-pressed={on}
              className={cn(
                "hr2 clicky relative block w-full overflow-hidden border-2 bg-paper2 text-left",
                on ? "border-hd-accent ring-2 ring-hd-accent" : "border-ink"
              )}
            >
              <div className="aspect-9/16 w-full bg-ink/10">
                {r.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : null}
              </div>
              {on ? (
                <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full border-2 border-ink bg-hd-accent text-paper">
                  <Check weight="bold" className="size-3.5" />
                </span>
              ) : null}
              <span className="line-clamp-2 px-1.5 pt-1 text-[11px] leading-tight">{r.hook || "No caption"}</span>
              <span className="block px-1.5 pb-1 text-[10px] text-muted-foreground">
                {r.reach ?? "–"} reach · {pct(r.hold3s)} hold
              </span>
              {extra ? <span className="block px-1.5 pb-1 text-[10px] font-semibold">{extra}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface Persona {
  id: string;
  name: string;
  emoji: string;
  isDefault: boolean;
}

/** Coach persona dropdown (loads once). */
export function PersonaSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  useEffect(() => {
    let alive = true;
    void fetch("/api/coach/personas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { data?: Persona[] } | null) => {
        if (!alive || !body?.data) return;
        setPersonas(body.data);
        const def = body.data.find((p) => p.isDefault) ?? body.data[0];
        if (def && !value) onChange(def.id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (personas.length === 0) return null;
  return (
    <label className="block">
      <span className="text-sm font-semibold">Coach</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="hr3 mt-1.5 h-11 w-full border-2 border-ink bg-paper px-3 text-base"
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.emoji ? `${p.emoji} ` : ""}
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Two taps: arm, then confirm. Disarms after 4 s. */
export function useArmed(): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return [
    armed,
    () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    },
  ];
}
