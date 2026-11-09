"use client";

import { cn } from "@/lib/utils";
import {
  pctLabel,
  rangeLabel,
  type ExpectedRetention,
  type Range,
} from "@/lib/coach/types";

/**
 * Compact "expected retention" chip: a 0-100% track with the expected range
 * filled, a tick at the likely value and (for fixes) a dot at what the reel
 * actually did. "Was 36% -> expected 52-60%".
 */
function Bar({
  label,
  range,
  actual,
}: {
  label: string;
  range: Range;
  actual?: number | null;
}) {
  const pos = (v: number) => `${Math.min(Math.max(v, 0), 1) * 100}%`;
  const hasActual = typeof actual === "number";
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline gap-x-1 text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {hasActual ? (
            <>
              Was {pctLabel(actual)} → {rangeLabel(range)}
            </>
          ) : (
            rangeLabel(range)
          )}
        </span>
      </p>
      <div
        className="relative mt-1 h-2.5 rounded-full border-[1.5px] border-ink bg-wash"
        role="img"
        aria-label={`${label}: expected ${rangeLabel(range)}${hasActual ? `, was ${pctLabel(actual)}` : ""}`}
      >
        <span
          className="absolute inset-y-0 rounded-full bg-parrot"
          style={{ left: pos(range.low), width: `calc(${pos(range.high)} - ${pos(range.low)})` }}
        />
        <span
          className="absolute -inset-y-0.5 w-0.5 bg-ink"
          style={{ left: pos(range.mid) }}
        />
        {hasActual && (
          <span
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-fox"
            style={{ left: pos(actual!) }}
          />
        )}
      </div>
    </div>
  );
}

export function RetentionChip({
  value,
  className,
  title = "Expected retention",
}: {
  value: ExpectedRetention | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!value || (!value.hold3s && !value.avgWatchPct)) return null;
  return (
    <div
      className={cn(
        "hr2 border-[1.8px] border-ink bg-paper2 px-2.5 py-2",
        className
      )}
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {value.hold3s && (
          <Bar
            label="3s hold"
            range={value.hold3s}
            actual={value.actual?.hold3s}
          />
        )}
        {value.avgWatchPct && (
          <Bar
            label="Avg watch"
            range={value.avgWatchPct}
            actual={value.actual?.avgWatchPct}
          />
        )}
      </div>
      {value.basis && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {value.basis}
        </p>
      )}
    </div>
  );
}
