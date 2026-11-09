/**
 * Cadence planner (research note R7): best posting slots from his own data,
 * this week's plan (main reels vs trials, gaps, best-slot markers), cadence
 * warnings and the next free slot for a new post. Pure module; every date
 * calculation takes an IANA time zone so it is deterministic in tests.
 */

import {
  DAY_MS,
  GENERIC_SLOTS,
  HOUR_MS,
  MAIN_REELS_PER_WEEK,
  MAX_TEST_BATCHES_PER_WEEK,
  MIN_LEAD_MINUTES,
  MIN_MAIN_GAP_HOURS,
  MIN_REELS_FOR_OWN_SLOTS,
  SLOT_HOUR_RANGE,
} from "@/lib/strategy/config";

const sensibleHour = (h: number) => h >= SLOT_HOUR_RANGE.min && h <= SLOT_HOUR_RANGE.max;

/* ------------------------------------------------------------------ */
/* Time zone helpers                                                   */
/* ------------------------------------------------------------------ */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

export function localParts(d: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** The instant that is `y-m-d h:min` on the wall clock in `timeZone`. */
export function zonedTime(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone: string
): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Local calendar day `offset` days after the day containing `d`. */
export function localDay(d: Date, offset: number, timeZone: string) {
  const p = localParts(d, timeZone);
  const noon = zonedTime(p.year, p.month, p.day, 12, 0, timeZone);
  const shifted = localParts(new Date(noon.getTime() + offset * DAY_MS), timeZone);
  return { year: shifted.year, month: shifted.month, day: shifted.day, weekday: shifted.weekday };
}

export function dayKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Best slots                                                          */
/* ------------------------------------------------------------------ */

export interface SlotSample {
  timestamp: string;
  reach: number | null;
  avgWatchTimeMs: number | null;
}

export interface BestSlots {
  source: "own" | "generic";
  /** Best local posting hour for each weekday (index 0 = Sunday). */
  hourByWeekday: number[];
  /** Weekdays best first (own data), or the natural order for generic. */
  rankedWeekdays: number[];
  /** One-line explanation for the UI. */
  note: string;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Score a bucket of reels by median reach and median watch time, each
 * relative to his overall median (1.0 = typical).
 */
function bucketScore(
  items: SlotSample[],
  overallReach: number | null,
  overallWatch: number | null
): number {
  const r = median(items.map((i) => i.reach).filter((x): x is number => x !== null));
  const w = median(items.map((i) => i.avgWatchTimeMs).filter((x): x is number => x !== null));
  const parts: number[] = [];
  if (r !== null && overallReach) parts.push(r / overallReach);
  if (w !== null && overallWatch) parts.push(w / overallWatch);
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
}

export function genericSlots(): BestSlots {
  const hourByWeekday = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    d === 0 || d === 6 ? GENERIC_SLOTS.weekend[0] : GENERIC_SLOTS.weekday[0]
  );
  return {
    source: "generic",
    hourByWeekday,
    rankedWeekdays: [2, 4, 1, 3, 0, 5, 6],
    note: `Generic times until you have ${MIN_REELS_FOR_OWN_SLOTS} reels with numbers.`,
  };
}

/**
 * Best hour per weekday from his own reels: hours (and weekdays) are ranked
 * by median reach and median watch time once he has MIN_REELS_FOR_OWN_SLOTS
 * reels with reach; buckets need 2+ reels to count.
 */
export function bestSlots(samples: SlotSample[], timeZone: string): BestSlots {
  const usable = samples.filter((s) => s.reach !== null && Number.isFinite(Date.parse(s.timestamp)));
  if (usable.length < MIN_REELS_FOR_OWN_SLOTS) return genericSlots();

  const overallReach = median(usable.map((s) => s.reach as number));
  const overallWatch = median(
    usable.map((s) => s.avgWatchTimeMs).filter((x): x is number => x !== null)
  );
  const byHour = new Map<number, SlotSample[]>();
  const byDay = new Map<number, SlotSample[]>();
  for (const s of usable) {
    const p = localParts(new Date(s.timestamp), timeZone);
    byHour.set(p.hour, [...(byHour.get(p.hour) ?? []), s]);
    byDay.set(p.weekday, [...(byDay.get(p.weekday) ?? []), s]);
  }
  const hours = [...byHour.entries()]
    .filter(([h, items]) => items.length >= 2 && sensibleHour(h))
    .map(([h, items]) => ({ h, score: bucketScore(items, overallReach, overallWatch) }))
    .sort((a, b) => b.score - a.score || b.h - a.h);
  if (hours.length === 0) return genericSlots();

  const dayScores = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const items = byDay.get(d) ?? [];
    return { d, score: items.length >= 2 ? bucketScore(items, overallReach, overallWatch) : 1 };
  });
  const rankedWeekdays = [...dayScores].sort((a, b) => b.score - a.score || a.d - b.d).map((x) => x.d);

  // Best hour on a given weekday: that weekday's own best hour if it has
  // 2+ reels in one hour, otherwise his best hour overall.
  const hourByWeekday = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const items = byDay.get(d) ?? [];
    const local = new Map<number, SlotSample[]>();
    for (const s of items) {
      const h = localParts(new Date(s.timestamp), timeZone).hour;
      local.set(h, [...(local.get(h) ?? []), s]);
    }
    const best = [...local.entries()]
      .filter(([h, xs]) => xs.length >= 2 && sensibleHour(h))
      .map(([h, xs]) => ({ h, score: bucketScore(xs, overallReach, overallWatch) }))
      .sort((a, b) => b.score - a.score)[0];
    return best && best.score >= hours[0].score * 0.9 ? best.h : hours[0].h;
  });

  return {
    source: "own",
    hourByWeekday,
    rankedWeekdays,
    note: `From ${usable.length} of your reels: median reach and watch time by posting hour and day.`,
  };
}

/** The best-slot instant on a local day. */
export function slotOn(day: { year: number; month: number; day: number; weekday: number }, slots: BestSlots, timeZone: string): Date {
  return zonedTime(day.year, day.month, day.day, slots.hourByWeekday[day.weekday], 0, timeZone);
}

/* ------------------------------------------------------------------ */
/* Week plan                                                           */
/* ------------------------------------------------------------------ */

export interface PlanPostInput {
  id: string;
  at: Date;
  /** Main reels count toward cadence; trials don't. */
  main: boolean;
  label: string;
  status: string;
  source: "scheduled" | "instagram";
  experimentId?: string | null;
}

export interface PlanPost {
  id: string;
  at: string;
  main: boolean;
  label: string;
  status: string;
  source: "scheduled" | "instagram";
  experimentId: string | null;
}

export interface PlanDay {
  key: string;
  weekday: number;
  label: string;
  posts: PlanPost[];
  /** Best-slot marker for this day (ISO), null when it's already past. */
  bestSlot: string | null;
  hasMain: boolean;
}

export interface WeekPlan {
  days: PlanDay[];
  mainCount: number;
  target: number;
  /** Suggested slots to reach the target (ISO), best first. */
  openSlots: string[];
  warnings: string[];
}

function tooClose(at: number, mains: number[], gapMs: number): boolean {
  return mains.some((m) => Math.abs(m - at) < gapMs);
}

const fmtSlot = (d: Date, timeZone: string) =>
  d.toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric" });

export function planWeek(args: {
  now: Date;
  timeZone: string;
  posts: PlanPostInput[];
  slots: BestSlots;
  perWeek?: number;
  minGapHours?: number;
}): WeekPlan {
  const { now, timeZone, slots } = args;
  const perWeek = args.perWeek ?? MAIN_REELS_PER_WEEK;
  const gapMs = (args.minGapHours ?? MIN_MAIN_GAP_HOURS) * HOUR_MS;
  const leadMs = MIN_LEAD_MINUTES * 60_000;

  const start = localDay(now, 0, timeZone);
  const windowStart = zonedTime(start.year, start.month, start.day, 0, 0, timeZone).getTime();
  const end = localDay(now, 7, timeZone);
  const windowEnd = zonedTime(end.year, end.month, end.day, 0, 0, timeZone).getTime();

  const active = args.posts.filter((p) => p.status !== "FAILED" && p.status !== "CANCELLED");
  const inWindow = active.filter((p) => p.at.getTime() >= windowStart && p.at.getTime() < windowEnd);
  const mains = active.filter((p) => p.main).map((p) => p.at.getTime());

  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = localDay(now, i, timeZone);
    const key = dayKey(d);
    const posts = inWindow
      .filter((p) => dayKey(localParts(p.at, timeZone)) === key)
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((p) => ({
        id: p.id,
        at: p.at.toISOString(),
        main: p.main,
        label: p.label,
        status: p.status,
        source: p.source,
        experimentId: p.experimentId ?? null,
      }));
    const slot = slotOn(d, slots, timeZone);
    days.push({
      key,
      weekday: d.weekday,
      label: i === 0 ? "Today" : WEEKDAYS[d.weekday],
      posts,
      bestSlot: slot.getTime() > now.getTime() + leadMs ? slot.toISOString() : null,
      hasMain: posts.some((p) => p.main),
    });
  }

  const mainCount = inWindow.filter((p) => p.main).length;
  const warnings: string[] = [];
  if (mainCount > perWeek) {
    warnings.push(
      `Over cadence: ${mainCount} main reels in the next 7 days (target ${perWeek}). Move one to a trial or next week.`
    );
  }
  const upcomingMains = inWindow
    .filter((p) => p.main && p.at.getTime() >= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const p of upcomingMains) {
    const clash = active.find(
      (q) => q.main && q.id !== p.id && q.at.getTime() < p.at.getTime() && p.at.getTime() - q.at.getTime() < gapMs
    );
    if (clash) {
      warnings.push(
        `Too close: "${p.label}" goes out ${Math.round((p.at.getTime() - clash.at.getTime()) / HOUR_MS)} h after "${clash.label}". Keep main reels ${Math.round(gapMs / HOUR_MS)} h apart.`
      );
    }
  }

  // Fill the week: best days first, each slot 24 h+ from every main reel.
  const openSlots: string[] = [];
  const taken = [...mains];
  let needed = Math.max(0, perWeek - mainCount);
  const order = [...days].sort(
    (a, b) => slots.rankedWeekdays.indexOf(a.weekday) - slots.rankedWeekdays.indexOf(b.weekday)
  );
  for (const day of order) {
    if (needed <= 0) break;
    if (!day.bestSlot || day.hasMain) continue;
    const at = Date.parse(day.bestSlot);
    if (tooClose(at, taken, gapMs)) continue;
    openSlots.push(day.bestSlot);
    taken.push(at);
    needed -= 1;
  }
  openSlots.sort();
  return { days, mainCount, target: perWeek, openSlots, warnings: dedupe(warnings) };
}

function dedupe(xs: string[]) {
  return [...new Set(xs)];
}

/* ------------------------------------------------------------------ */
/* Next free slot                                                      */
/* ------------------------------------------------------------------ */

/**
 * First best slot after `notBefore` (and the minimum lead time). Main reels
 * also keep MIN_MAIN_GAP_HOURS from every other main reel; trials only need
 * a slot (they don't count toward cadence). Looks 21 days ahead.
 */
export function findSlot(args: {
  now: Date;
  timeZone: string;
  slots: BestSlots;
  posts: PlanPostInput[];
  main: boolean;
  notBefore?: Date;
  /** For a test batch: how long the batch occupies (variants are staggered). */
  spanMinutes?: number;
}): Date {
  const { now, timeZone, slots } = args;
  const lead = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const floor = Math.max(lead, args.notBefore?.getTime() ?? 0);
  const gapMs = MIN_MAIN_GAP_HOURS * HOUR_MS;
  const mains = args.posts
    .filter((p) => p.main && p.status !== "FAILED")
    .map((p) => p.at.getTime());
  const busy = args.posts.filter((p) => p.status !== "FAILED").map((p) => p.at.getTime());
  const span = (args.spanMinutes ?? 0) * 60_000;
  const startDay = localDay(new Date(floor), 0, timeZone);
  const base = zonedTime(startDay.year, startDay.month, startDay.day, 12, 0, timeZone);
  for (let i = 0; i < 21; i++) {
    const d = localDay(base, i, timeZone);
    const at = slotOn(d, slots, timeZone).getTime();
    if (at < floor) continue;
    if (args.main && tooClose(at, mains, gapMs)) continue;
    // Don't drop a batch on top of another post's minute.
    if (busy.some((b) => b >= at - 10 * 60_000 && b <= at + span + 10 * 60_000)) continue;
    return new Date(at);
  }
  // Nothing fits in three weeks: the earliest allowed time.
  return new Date(floor);
}

/** True when another test batch at `at` would exceed the weekly limit. */
export function overTestLimit(batchStarts: Date[], at: Date, limit = MAX_TEST_BATCHES_PER_WEEK): boolean {
  const t = at.getTime();
  const before = batchStarts.filter((b) => b.getTime() > t - 7 * DAY_MS && b.getTime() <= t).length;
  const after = batchStarts.filter((b) => b.getTime() >= t && b.getTime() < t + 7 * DAY_MS).length;
  return before >= limit || after >= limit;
}

export function describeSlot(d: Date, timeZone: string): string {
  return fmtSlot(d, timeZone);
}
