/**
 * Winner scoring and the decision rule for hook tests (research note R4).
 * Pure module: no I/O, safe for tests and client components.
 *
 * NORMALISATION (why percentiles): the five ratios live on very different
 * scales (hold is ~0.5-0.8, shares/reach ~0.001-0.05), so a raw weighted sum
 * would be dominated by whichever ratio happens to be biggest. Each ratio is
 * converted to its mid-rank percentile (0-1) inside a reference pool: his own
 * past trial variants when he has at least MIN_TRIAL_REFERENCE of them,
 * otherwise his own recent reels, always plus the variants being judged (so
 * the pool is never empty). A percentile is robust to the heavy tails reach
 * ratios have (one viral reel doesn't squash everything else the way a
 * z-score would) and reads naturally: 0.7 = "better than 70% of your own".
 * Only components every judged variant has are used; their weights are
 * re-normalised to sum to 1.
 */

import {
  CORE_COMPONENTS,
  EARLIEST_DECISION_HOURS,
  FINAL_DECISION_HOURS,
  MIN_CORE_WINS,
  MIN_REACH_PER_VARIANT,
  SCORE_WEIGHTS,
  WIN_MARGIN,
  type ScoreComponent,
  type TestVariable,
} from "@/lib/strategy/config";

/** Raw numbers for one reel / variant (any may be missing). */
export interface RawMetrics {
  reach: number | null;
  views?: number | null;
  likes: number | null;
  saved: number | null;
  shares: number | null;
  /** Average watch time, milliseconds. */
  avgWatchMs: number | null;
  /** 3-second skip rate, 0-1. */
  skipRate: number | null;
  /** Reel length, seconds. */
  durationSec: number | null;
}

export type RatioSet = Record<ScoreComponent, number | null>;

const COMPONENTS = Object.keys(SCORE_WEIGHTS) as ScoreComponent[];

function perReach(n: number | null, reach: number | null): number | null {
  if (n === null || reach === null || !(reach > 0)) return null;
  return n / reach;
}

/** The five ratios the score is built from. */
export function ratiosOf(m: RawMetrics): RatioSet {
  const watch =
    m.avgWatchMs !== null && m.durationSec !== null && m.durationSec > 0
      ? Math.min(m.avgWatchMs / 1000 / m.durationSec, 1.5)
      : null;
  return {
    watch,
    hold: m.skipRate === null ? null : Math.min(Math.max(1 - m.skipRate, 0), 1),
    shares: perReach(m.shares, m.reach),
    saves: perReach(m.saved, m.reach),
    likes: perReach(m.likes, m.reach),
  };
}

/** Mid-rank percentile of `value` inside `pool` (0-1; 0.5 for an empty pool). */
export function percentile(value: number, pool: number[]): number {
  if (pool.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of pool) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + equal / 2) / pool.length;
}

export interface VariantInput {
  id: string;
  label: string;
  metrics: RawMetrics | null;
}

export interface ScoredVariant {
  id: string;
  label: string;
  reach: number | null;
  ratios: RatioSet;
  /** Percentile of each ratio in the reference pool. */
  pct: RatioSet;
  /** Weighted percentile score, 0-1; null when nothing could be scored. */
  score: number | null;
  eligible: boolean;
}

/**
 * Score variants against a reference pool of ratio sets (his past trials or
 * reels). Components missing for any variant are left out of everyone's score.
 */
export function scoreVariants(
  variants: VariantInput[],
  reference: RatioSet[]
): { scored: ScoredVariant[]; components: ScoreComponent[] } {
  const withRatios = variants.map((v) => ({
    ...v,
    ratios: v.metrics ? ratiosOf(v.metrics) : emptyRatios(),
  }));
  const components = COMPONENTS.filter(
    (c) => withRatios.length > 0 && withRatios.every((v) => v.ratios[c] !== null)
  );
  const pools = Object.fromEntries(
    COMPONENTS.map((c) => [
      c,
      [...reference, ...withRatios.map((v) => v.ratios)]
        .map((r) => r[c])
        .filter((x): x is number => x !== null && Number.isFinite(x)),
    ])
  ) as Record<ScoreComponent, number[]>;
  const weightSum = components.reduce((s, c) => s + SCORE_WEIGHTS[c], 0);

  const scored = withRatios.map((v) => {
    const pct = emptyRatios();
    for (const c of COMPONENTS) {
      const r = v.ratios[c];
      pct[c] = r === null ? null : percentile(r, pools[c]);
    }
    const score =
      weightSum > 0
        ? components.reduce((s, c) => s + (pct[c] ?? 0) * SCORE_WEIGHTS[c], 0) / weightSum
        : null;
    const reach = v.metrics?.reach ?? null;
    return {
      id: v.id,
      label: v.label,
      reach,
      ratios: v.ratios,
      pct,
      score,
      eligible: reach !== null && reach >= MIN_REACH_PER_VARIANT && score !== null,
    };
  });
  return { scored, components };
}

export function emptyRatios(): RatioSet {
  return { watch: null, hold: null, shares: null, saves: null, likes: null };
}

/* ------------------------------------------------------------------ */
/* Decision                                                            */
/* ------------------------------------------------------------------ */

export type DecisionOutcome = "wait" | "winner" | "no_winner";

export interface Decision {
  outcome: DecisionOutcome;
  /** Plain-English reason shown to him. */
  reason: string;
  winnerId: string | null;
  /** (leader - runner-up) / runner-up, when there are two scored variants. */
  margin: number | null;
  coreWins: number | null;
  coreNeeded: number | null;
  /** For no_winner: what to test next and why. */
  nextVariable: TestVariable | null;
  nextReason: string | null;
}

export interface DecideOptions {
  /** Hours since the youngest variant went out. */
  ageHours: number;
  variable: TestVariable;
  /** Every variant has published (none still scheduled / failed). */
  allPublished: boolean;
}

const pctText = (x: number) => `${Math.round(x * 100)}%`;

function decision(partial: Partial<Decision> & Pick<Decision, "outcome" | "reason">): Decision {
  return {
    winnerId: null,
    margin: null,
    coreWins: null,
    coreNeeded: null,
    nextVariable: null,
    nextReason: null,
    ...partial,
  };
}

/** Leader is strictly best on this ratio among the judged variants. */
function winsOn(leader: ScoredVariant, others: ScoredVariant[], c: ScoreComponent): boolean {
  const mine = leader.ratios[c];
  if (mine === null) return false;
  return others.every((o) => o.ratios[c] === null || (o.ratios[c] as number) < mine);
}

export function decide(
  scored: ScoredVariant[],
  components: ScoreComponent[],
  opts: DecideOptions
): Decision {
  const final = opts.ageHours >= FINAL_DECISION_HOURS;
  if (!opts.allPublished) {
    return decision({ outcome: "wait", reason: "Not every variant is out yet." });
  }
  if (opts.ageHours < EARLIEST_DECISION_HOURS) {
    return decision({
      outcome: "wait",
      reason: `Too early. First call at ${EARLIEST_DECISION_HOURS} h, final at ${FINAL_DECISION_HOURS} h.`,
    });
  }

  // Before the final call every variant needs the minimum reach; at the
  // final call we judge whichever variants reached it.
  const pool = final ? scored.filter((v) => v.eligible) : scored;
  const underReached = scored.filter((v) => !v.eligible);
  if (!final && underReached.length > 0) {
    return decision({
      outcome: "wait",
      reason: `Waiting for ${MIN_REACH_PER_VARIANT}+ reach on ${underReached
        .map((v) => v.label)
        .join(", ")}.`,
    });
  }
  if (pool.length < 2) {
    const next = suggestNext(opts.variable, scored, "reach");
    return decision({
      outcome: "no_winner",
      reason: `Not enough reach to judge: fewer than two variants got ${MIN_REACH_PER_VARIANT}+ accounts reached in ${FINAL_DECISION_HOURS} h.`,
      ...next,
    });
  }

  const ranked = [...pool].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const [leader, runner] = ranked;
  const lead = leader.score ?? 0;
  const second = runner.score ?? 0;
  const margin = second > 0 ? (lead - second) / second : lead > 0 ? Infinity : 0;
  const cores = CORE_COMPONENTS.filter((c) => components.includes(c));
  const others = ranked.slice(1);
  const coreWins = cores.filter((c) => winsOn(leader, others, c)).length;
  const coreNeeded = Math.min(MIN_CORE_WINS, cores.length);
  const marginOk = margin >= WIN_MARGIN;
  const coresOk = cores.length > 0 && coreWins >= coreNeeded;

  if (marginOk && coresOk) {
    return decision({
      outcome: "winner",
      winnerId: leader.id,
      margin: Number.isFinite(margin) ? margin : null,
      coreWins,
      coreNeeded,
      reason: `${leader.label} wins: score ${pctText(lead)} vs ${runner.label} ${pctText(second)}${
        Number.isFinite(margin) ? ` (+${pctText(margin)})` : ""
      }, best on ${coreWins} of ${cores.length} core numbers.`,
    });
  }

  const why = !marginOk
    ? `${leader.label} leads ${runner.label} by ${Number.isFinite(margin) ? pctText(margin) : "?"}, under the ${pctText(WIN_MARGIN)} needed`
    : `${leader.label} is best on only ${coreWins} of ${cores.length} core numbers (needs ${coreNeeded})`;
  if (!final) {
    return decision({
      outcome: "wait",
      margin: Number.isFinite(margin) ? margin : null,
      coreWins,
      coreNeeded,
      reason: `Too close to call yet: ${why}. Final call at ${FINAL_DECISION_HOURS} h.`,
    });
  }
  return decision({
    outcome: "no_winner",
    margin: Number.isFinite(margin) ? margin : null,
    coreWins,
    coreNeeded,
    reason: `No clear winner: ${why}.`,
    ...suggestNext(opts.variable, pool, "close"),
  });
}

/** Average percentile of a component across variants (null when missing). */
function avgPct(vs: ScoredVariant[], c: ScoreComponent): number | null {
  const xs = vs.map((v) => v.pct[c]).filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

const ROTATION: Record<TestVariable, TestVariable> = {
  hook: "first_frame",
  first_frame: "hook",
  cover: "hook",
  caption: "cover",
  length: "hook",
};

/** What to re-test after a no-winner, from where the whole batch was weak. */
export function suggestNext(
  variable: TestVariable,
  vs: ScoredVariant[],
  cause: "reach" | "close"
): Pick<Decision, "nextVariable" | "nextReason"> {
  if (cause === "reach") {
    return {
      nextVariable: variable,
      nextReason:
        "Re-test the same thing at your best slot so each variant gets enough reach to judge.",
    };
  }
  const hold = avgPct(vs, "hold");
  const watch = avgPct(vs, "watch");
  if (hold !== null && hold < 0.4) {
    const next = variable === "hook" ? "first_frame" : "hook";
    return {
      nextVariable: next,
      nextReason:
        next === "hook"
          ? "Every variant lost people in the first 3 seconds. Test bolder hooks next."
          : "Every hook lost people in the first 3 seconds, so the words may not be the problem. Test a different first frame (start the video later).",
    };
  }
  if (watch !== null && watch < 0.4) {
    return {
      nextVariable: "length",
      nextReason: "People stayed past the hook but left early. Test a tighter cut.",
    };
  }
  const next = ROTATION[variable];
  return {
    nextVariable: next,
    nextReason: `These ${variable === "first_frame" ? "openings" : `${variable}s`} performed about the same. Keep the best one and test the ${next.replace("_", " ")} next.`,
  };
}
