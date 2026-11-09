/**
 * Suggested posting slot, computed in the viewer's own time zone (so it runs
 * in the browser). Same idea as Hook Coach's "best time": the hour your top
 * posts went out most often. No history → tomorrow at 7 pm.
 * Pure module: safe to import from client components.
 */

export interface SuggestedSlot {
  at: Date;
  /** "From your top posts" or the default. */
  reason: "top-posts" | "default";
  hour: number;
}

const DEFAULT_HOUR = 19;
/** Never suggest a slot sooner than this, so there is time to finish the form. */
const MIN_LEAD_MS = 30 * 60_000;

/** Most common local hour among the timestamps (ties: the later hour). */
export function bestLocalHour(timestamps: string[]): number | null {
  const counts = new Map<number, number>();
  for (const ts of timestamps) {
    const d = new Date(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (Number.isNaN(d.getTime())) continue;
    const h = d.getHours();
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [h, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== null && h > best)) {
      best = h;
      bestCount = c;
    }
  }
  return best;
}

export function suggestSlot(
  topPostTimestamps: string[],
  now: Date = new Date()
): SuggestedSlot {
  const hour = bestLocalHour(topPostTimestamps);
  if (hour === null) {
    const at = new Date(now);
    at.setDate(at.getDate() + 1);
    at.setHours(DEFAULT_HOUR, 0, 0, 0);
    return { at, reason: "default", hour: DEFAULT_HOUR };
  }
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() - now.getTime() < MIN_LEAD_MS) at.setDate(at.getDate() + 1);
  return { at, reason: "top-posts", hour };
}

/** `YYYY-MM-DDTHH:mm` in local time, for <input type="datetime-local">. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
