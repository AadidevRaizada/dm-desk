import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { parseMediaInsights } from "@/lib/meta/client";
import {
  bestSlots,
  findSlot,
  genericSlots,
  localParts,
  overTestLimit,
  planWeek,
  zonedTime,
  type PlanPostInput,
} from "@/lib/strategy/cadence";
import { repostCandidates, type ReelStat } from "@/lib/strategy/candidates";
import {
  MAX_TEST_BATCHES_PER_WEEK,
  MIN_REACH_PER_VARIANT,
  MIN_REELS_FOR_OWN_SLOTS,
} from "@/lib/strategy/config";
import { dueCheckpoint, toPostMetrics } from "@/lib/strategy/evaluate";
import {
  decide,
  percentile,
  ratiosOf,
  scoreVariants,
  type RawMetrics,
  type VariantInput,
} from "@/lib/strategy/score";
import { buildMoves, hookTestMoves, part2Moves } from "@/lib/strategy/suggest";

const H = 60 * 60_000;
const D = 24 * H;

function m(over: Partial<RawMetrics> = {}): RawMetrics {
  return {
    reach: 1000,
    likes: 40,
    saved: 5,
    shares: 5,
    avgWatchMs: 8000,
    skipRate: 0.5,
    durationSec: 20,
    ...over,
  };
}

const v = (id: string, metrics: RawMetrics | null): VariantInput => ({ id, label: id, metrics });

/* ------------------------------------------------------------------ */
/* R9: insights parsing                                                */
/* ------------------------------------------------------------------ */

describe("parseMediaInsights", () => {
  it("returns null (not 0) for requested metrics Meta left out or sent empty", () => {
    const out = parseMediaInsights(
      ["reach", "shares", "reels_skip_rate", "ig_reels_avg_watch_time"],
      [
        { name: "reach", values: [{ value: 120 }] },
        { name: "reels_skip_rate", total_value: { value: 41.5 } },
        { name: "shares", values: [] },
      ]
    );
    expect(out).toEqual({
      reach: 120,
      shares: null,
      reels_skip_rate: 41.5,
      ig_reels_avg_watch_time: null,
    });
  });

  it("keeps a real zero", () => {
    expect(parseMediaInsights(["shares"], [{ name: "shares", values: [{ value: 0 }] }]).shares).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* R4: scoring                                                         */
/* ------------------------------------------------------------------ */

describe("score", () => {
  it("builds the five ratios from raw numbers", () => {
    const r = ratiosOf(m({ avgWatchMs: 10_000, durationSec: 20, skipRate: 0.4, shares: 20, saved: 10, likes: 50 }));
    expect(r.watch).toBeCloseTo(0.5);
    expect(r.hold).toBeCloseTo(0.6);
    expect(r.shares).toBeCloseTo(0.02);
    expect(r.saves).toBeCloseTo(0.01);
    expect(r.likes).toBeCloseTo(0.05);
  });

  it("uses mid-rank percentiles", () => {
    expect(percentile(5, [1, 5, 9])).toBeCloseTo(0.5);
    expect(percentile(10, [1, 2, 3])).toBe(1);
    expect(percentile(0, [1, 2, 3])).toBe(0);
    expect(percentile(3, [])).toBe(0.5);
  });

  it("drops a component any variant is missing and renormalises weights", () => {
    const { scored, components } = scoreVariants(
      [v("A", m({ skipRate: null })), v("B", m())],
      []
    );
    expect(components).not.toContain("hold");
    for (const s of scored) expect(s.score).toBeGreaterThanOrEqual(0);
    expect(scored[0].score).toBeCloseTo(scored[1].score as number);
  });

  it("marks variants under the minimum reach as not eligible", () => {
    const { scored } = scoreVariants([v("A", m({ reach: MIN_REACH_PER_VARIANT - 1 })), v("B", m())], []);
    expect(scored[0].eligible).toBe(false);
    expect(scored[1].eligible).toBe(true);
  });
});

describe("decide", () => {
  // A clearly better on watch, hold and shares.
  const strong = m({ avgWatchMs: 14_000, skipRate: 0.3, shares: 30, saved: 12, likes: 60 });
  const weak = m({ avgWatchMs: 6_000, skipRate: 0.6, shares: 4, saved: 3, likes: 30 });
  const reference = [m(), m({ shares: 10 }), m({ skipRate: 0.45 }), m({ avgWatchMs: 9000 })].map(ratiosOf);

  const run = (variants: VariantInput[], ageHours: number, allPublished = true) => {
    const { scored, components } = scoreVariants(variants, reference);
    return decide(scored, components, { ageHours, variable: "hook", allPublished });
  };

  it("waits before 48 h even with a clear leader", () => {
    expect(run([v("A", strong), v("B", weak)], 30).outcome).toBe("wait");
  });

  it("waits while a variant is unpublished", () => {
    expect(run([v("A", strong), v("B", weak)], 60, false).outcome).toBe("wait");
  });

  it("calls a winner at 48 h when margin and core wins are met", () => {
    const d = run([v("A", strong), v("B", weak), v("C", weak)], 49);
    expect(d.outcome).toBe("winner");
    expect(d.winnerId).toBe("A");
    expect(d.coreWins).toBe(3);
    expect(d.margin).toBeGreaterThanOrEqual(0.2);
  });

  it("waits at 48 h if any variant is under the minimum reach", () => {
    const d = run([v("A", strong), v("B", { ...weak, reach: 120 })], 50);
    expect(d.outcome).toBe("wait");
    expect(d.reason).toMatch(/B/);
  });

  it("at 72 h judges only variants with enough reach", () => {
    const d = run([v("A", strong), v("B", weak), v("C", { ...strong, reach: 100, shares: 90 })], 73);
    expect(d.outcome).toBe("winner");
    expect(d.winnerId).toBe("A");
  });

  it("no winner at 72 h when fewer than two variants reached the minimum", () => {
    const d = run([v("A", { ...strong, reach: 200 }), v("B", { ...weak, reach: 150 })], 73);
    expect(d.outcome).toBe("no_winner");
    expect(d.reason).toMatch(/Not enough reach/);
    expect(d.nextVariable).toBe("hook");
  });

  it("treats a tie as no clear winner at the final call", () => {
    const d = run([v("A", m()), v("B", m())], 72);
    expect(d.outcome).toBe("no_winner");
    expect(d.margin).toBe(0);
    expect(d.nextVariable).not.toBeNull();
    expect(d.nextReason).toBeTruthy();
  });

  it("is still waiting (not no_winner) when close between 48 and 72 h", () => {
    expect(run([v("A", m()), v("B", m())], 55).outcome).toBe("wait");
  });

  it("needs 2 of 3 core ratios even with a big score margin", () => {
    // A wins shares, saves and likes by a mile but loses watch and hold.
    const a = m({ shares: 80, saved: 40, likes: 200, avgWatchMs: 7000, skipRate: 0.55 });
    const b = m({ shares: 2, saved: 1, likes: 10, avgWatchMs: 8000, skipRate: 0.5 });
    const d = run([v("A", a), v("B", b)], 73);
    expect(d.coreWins).toBe(1);
    expect(d.outcome).toBe("no_winner");
    expect(d.reason).toMatch(/core/);
  });

  it("suggests the first frame after a hook test where every hook lost people early", () => {
    const bad = m({ skipRate: 0.9, avgWatchMs: 8000 });
    const { scored, components } = scoreVariants([v("A", bad), v("B", { ...bad, skipRate: 0.91 })], [
      ...reference,
      ...[0.2, 0.25, 0.3, 0.35].map((s) => ratiosOf(m({ skipRate: s }))),
    ]);
    const d = decide(scored, components, { ageHours: 80, variable: "hook", allPublished: true });
    expect(d.outcome).toBe("no_winner");
    expect(d.nextVariable).toBe("first_frame");
  });
});

/* ------------------------------------------------------------------ */
/* R2: checkpoints                                                     */
/* ------------------------------------------------------------------ */

describe("checkpoints", () => {
  const pub = new Date("2026-11-01T00:00:00Z");
  it("pulls the newest due checkpoint once", () => {
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 10 * H), [])).toBeNull();
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 25 * H), [])).toBe(24);
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 25 * H), ["24"])).toBeNull();
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 50 * H), ["24"])).toBe(48);
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 100 * H), ["24", "48", "72"])).toBe(96);
    expect(dueCheckpoint(pub, new Date(pub.getTime() + 200 * H), ["24", "48", "72", "96"])).toBeNull();
  });

  it("stores latest numbers plus a snapshot per checkpoint, skip rate as 0-1", () => {
    const at = new Date("2026-11-02T00:00:00Z");
    const first = toPostMetrics({ reach: 500, shares: null, reels_skip_rate: 42 }, null, 24, at);
    expect(first.reach).toBe(500);
    expect(first.shares).toBeNull();
    expect(first.skipRate).toBeCloseTo(0.42);
    const second = toPostMetrics({ reach: 900 }, first, 48, at);
    expect(Object.keys(second.checkpoints)).toEqual(["24", "48"]);
    expect(second.checkpoints["24"].reach).toBe(500);
    expect(second.reach).toBe(900);
  });
});

/* ------------------------------------------------------------------ */
/* R1: repost candidates                                               */
/* ------------------------------------------------------------------ */

function reel(id: string, daysAgo: number, over: Partial<ReelStat> = {}, now = new Date("2026-11-09T12:00:00Z")): ReelStat {
  return {
    id,
    timestamp: new Date(now.getTime() - daysAgo * D).toISOString(),
    hook: `hook ${id}`,
    caption: `caption ${id}`,
    permalink: null,
    thumbnailUrl: null,
    reach: 1000,
    shares: 5,
    saved: 2,
    likes: 30,
    avgWatchTimeMs: 6000,
    skipRate: 0.5,
    hold3s: 0.5,
    ...over,
  };
}

describe("repostCandidates", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const reels = [
    reel("old-top-shares", 45, { shares: 60 }), // top by shares/reach
    reel("old-top-watch", 60, { avgWatchTimeMs: 20_000 }), // top by watch
    reel("young-top", 10, { shares: 80, avgWatchTimeMs: 25_000 }), // too young
    ...Array.from({ length: 7 }, (_, i) => reel(`old-${i}`, 40 + i)),
  ];

  it("takes the top 20% by shares/reach or watch time, 30+ days old", () => {
    const ids = repostCandidates(reels, { now }).map((c) => c.reel.id);
    expect(ids).toContain("old-top-shares");
    expect(ids).toContain("old-top-watch");
    expect(ids).not.toContain("young-top");
    expect(ids.some((id) => id.startsWith("old-") && /^old-\d$/.test(id))).toBe(false);
  });

  it("never schedules before the 30-day default gap", () => {
    for (const c of repostCandidates(reels, { now })) {
      expect(c.earliestAt.getTime()).toBeGreaterThanOrEqual(Date.parse(c.reel.timestamp) + 30 * D);
      expect(c.earliestAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });

  it("skips reels already reposted recently", () => {
    const ids = repostCandidates(reels, { now, recentRepostSources: new Set(["old-top-shares"]) }).map((c) => c.reel.id);
    expect(ids).not.toContain("old-top-shares");
  });

  it("ignores reels without reach", () => {
    expect(repostCandidates([reel("x", 50, { reach: null })], { now })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* R7: cadence                                                         */
/* ------------------------------------------------------------------ */

describe("cadence", () => {
  const tz = "Asia/Kolkata";
  const now = zonedTime(2026, 11, 9, 10, 0, tz); // Mon 10:00 local

  it("converts wall-clock time in a zone and back", () => {
    const d = zonedTime(2026, 11, 12, 19, 0, tz);
    expect(d.toISOString()).toBe("2026-11-12T13:30:00.000Z");
    expect(localParts(d, tz)).toMatchObject({ hour: 19, day: 12, weekday: 4 });
  });

  it("falls back to generic slots below the minimum reel count", () => {
    const slots = bestSlots(
      Array.from({ length: MIN_REELS_FOR_OWN_SLOTS - 1 }, (_, i) => ({ timestamp: new Date(now.getTime() - i * D).toISOString(), reach: 100, avgWatchTimeMs: 5000 })),
      tz
    );
    expect(slots.source).toBe("generic");
  });

  it("learns his best hour from median reach and watch time", () => {
    const samples = Array.from({ length: 20 }, (_, i) => {
      const good = i % 2 === 0;
      const day = 1 + i;
      return {
        timestamp: zonedTime(2026, 10, day, good ? 18 : 9, 0, tz).toISOString(),
        reach: good ? 3000 : 500,
        avgWatchTimeMs: good ? 9000 : 4000,
      };
    });
    const slots = bestSlots(samples, tz);
    expect(slots.source).toBe("own");
    expect(new Set(slots.hourByWeekday)).toEqual(new Set([18]));
  });

  it("never suggests a 3 am slot even if 3 am posts did well", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      timestamp: zonedTime(2026, 10, 1 + i, i % 2 ? 3 : 20, 0, tz).toISOString(),
      reach: i % 2 ? 5000 : 800,
      avgWatchTimeMs: 6000,
    }));
    expect(bestSlots(samples, tz).hourByWeekday.every((h) => h === 20)).toBe(true);
  });

  const post = (id: string, at: Date, main: boolean, status = "SCHEDULED"): PlanPostInput => ({
    id,
    at,
    main,
    label: id,
    status,
    source: "scheduled",
  });

  it("plans the week: counts main reels only and fills best slots 24 h+ apart", () => {
    const plan = planWeek({
      now,
      timeZone: tz,
      slots: genericSlots(),
      posts: [
        post("main1", zonedTime(2026, 11, 10, 19, 0, tz), true),
        post("trialA", zonedTime(2026, 11, 11, 19, 0, tz), false),
        post("trialB", zonedTime(2026, 11, 11, 19, 15, tz), false),
      ],
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.mainCount).toBe(1);
    expect(plan.openSlots).toHaveLength(2);
    const mains = [zonedTime(2026, 11, 10, 19, 0, tz).getTime(), ...plan.openSlots.map((s) => Date.parse(s))];
    for (let i = 0; i < mains.length; i++)
      for (let j = i + 1; j < mains.length; j++) expect(Math.abs(mains[i] - mains[j])).toBeGreaterThanOrEqual(24 * H);
    expect(plan.days[2].posts.filter((p) => !p.main)).toHaveLength(2);
    expect(plan.warnings).toEqual([]);
  });

  it("warns about too-close main reels and over cadence", () => {
    const plan = planWeek({
      now,
      timeZone: tz,
      slots: genericSlots(),
      posts: [
        post("a", zonedTime(2026, 11, 10, 9, 0, tz), true),
        post("b", zonedTime(2026, 11, 10, 19, 0, tz), true),
        post("c", zonedTime(2026, 11, 12, 19, 0, tz), true),
        post("d", zonedTime(2026, 11, 14, 19, 0, tz), true),
      ],
    });
    expect(plan.warnings.some((w) => w.startsWith("Over cadence"))).toBe(true);
    expect(plan.warnings.some((w) => w.startsWith("Too close"))).toBe(true);
    expect(plan.openSlots).toEqual([]);
  });

  it("finds the next main slot 24 h from other main reels; trials ignore cadence", () => {
    const posts = [post("m", zonedTime(2026, 11, 9, 19, 0, tz), true)];
    const main = findSlot({ now, timeZone: tz, slots: genericSlots(), posts, main: true });
    expect(main.getTime() - posts[0].at.getTime()).toBeGreaterThanOrEqual(24 * H);
    const trial = findSlot({ now, timeZone: tz, slots: genericSlots(), posts: [], main: false });
    expect(trial.toISOString()).toBe(zonedTime(2026, 11, 9, 19, 0, tz).toISOString());
  });

  it("limits test batches per week", () => {
    const at = new Date("2026-11-10T12:00:00Z");
    const starts = Array.from({ length: MAX_TEST_BATCHES_PER_WEEK }, (_, i) => new Date(at.getTime() - (i + 1) * D));
    expect(overTestLimit(starts, at)).toBe(true);
    expect(overTestLimit(starts.slice(1), at)).toBe(false);
    expect(overTestLimit(starts, new Date(at.getTime() + 8 * D))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Suggested moves                                                     */
/* ------------------------------------------------------------------ */

describe("moves", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const tz = "UTC";
  const emptyPlan = planWeek({ now, timeZone: tz, slots: genericSlots(), posts: [] });

  it("flags hook problems: good watch time, poor 3-second hold", () => {
    const reels = [
      reel("hooky", 5, { avgWatchTimeMs: 15_000, hold3s: 0.3, skipRate: 0.7 }, now),
      ...[0.5, 0.55, 0.6, 0.65, 0.7].map((h, i) => reel(`r${i}`, 6 + i, { avgWatchTimeMs: 5000 + i * 100, hold3s: h }, now)),
    ];
    const moves = hookTestMoves({ now, timeZone: tz, reels, tags: new Map(), candidates: [], experiments: [], plan: emptyPlan, usedSources: new Set() });
    expect(moves[0]?.action).toEqual({ type: "test_hooks", mediaId: "hooky", idea: null });
  });

  it("suggests a Part 2 when a format beats his median shares/reach by 1.5x", () => {
    const reels = [
      reel("t1", 4, { shares: 40 }, now),
      reel("t2", 8, { shares: 30 }, now),
      reel("o1", 5, { shares: 5 }, now),
      reel("o2", 6, { shares: 6 }, now),
      reel("o3", 7, { shares: 4 }, now),
    ];
    const tags = new Map([
      ["t1", { format: "tutorial", topic: "cold dms" }],
      ["t2", { format: "tutorial", topic: "cold dms" }],
      ["o1", { format: "story", topic: "x" }],
      ["o2", { format: "story", topic: "x" }],
      ["o3", { format: "opinion", topic: "y" }],
    ]);
    const moves = part2Moves({ now, timeZone: tz, reels, tags, candidates: [], experiments: [], plan: emptyPlan, usedSources: new Set() });
    expect(moves).toHaveLength(1);
    expect(moves[0].title).toMatch(/tutorial/);
    expect(moves[0].action.type).toBe("plan_post");
  });

  it("ranks push-the-winner above everything and fills the week", () => {
    const moves = buildMoves({
      now,
      timeZone: tz,
      reels: [],
      tags: new Map(),
      candidates: [],
      plan: emptyPlan,
      usedSources: new Set(),
      experiments: [
        {
          id: "e1",
          kind: "ab_test",
          name: "Hook test",
          variable: "hook",
          status: "decided",
          error: null,
          createdAt: now.toISOString(),
          decidedAt: now.toISOString(),
          winnerPostId: "p1",
          decision: null,
          progress: null,
          startAt: now.toISOString(),
          sourceMediaId: null,
          variants: [
            {
              id: "p1",
              label: "A",
              hook: "Stop doing this",
              caption: "",
              status: "PUBLISHED",
              scheduledAt: now.toISOString(),
              publishedAt: now.toISOString(),
              permalink: "https://instagram.com/reel/x",
              error: null,
              hasCover: true,
              durationSec: 20,
              metrics: null,
              metricsAt: null,
              graduatedAt: null,
              trial: true,
            },
          ],
        },
      ],
    });
    expect(moves[0].kind).toBe("push_winner");
    expect(moves.some((mv) => mv.kind === "fill_week")).toBe(true);
  });
});
