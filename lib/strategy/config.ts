/**
 * Posting strategy engine: every default in one place.
 * Pure module (no server imports): safe for client components and tests.
 *
 * Sources for the numbers are summarised next to each group (research notes
 * R1-R8 in the strategy brief). Change them here, not in the callers.
 */

/* ---------------------------------------------------------- R1 reposts */

/** Days to wait before reposting a re-edit of a reel. */
export const REPOST_DEFAULT_GAP_DAYS = 30;
/** Never schedule a repost sooner than this after the original. */
export const REPOST_MIN_GAP_DAYS = 21;
/** A reel must be at least this old to be a repost candidate. */
export const REPOST_MIN_AGE_DAYS = 30;
/** Candidates come from his top share of reels (0.2 = top 20%). */
export const REPOST_TOP_FRACTION = 0.2;
/** ...but always consider at least this many when he has few reels. */
export const REPOST_MIN_CANDIDATES = 1;
/** Reposts cut this much dead air off the start by default (seconds). */
export const REPOST_DEFAULT_TRIM_SEC = 0.6;
/** Reposts go out as trial reels (non-followers) unless he switches it off. */
export const REPOST_TRIAL_BY_DEFAULT = true;

/* ------------------------------------------------- R2 trial read times */

/** Hours after publishing when insights are pulled. */
export const CHECKPOINT_HOURS = [24, 48, 72, 96] as const;
/** Earliest a winner can be called. */
export const EARLIEST_DECISION_HOURS = 48;
/** Final call: winner or "no clear winner". */
export const FINAL_DECISION_HOURS = 72;
/** One more pull after the decision because API insights can lag ~48 h. */
export const REPULL_HOURS = 96;
/** A/B batches use MANUAL so several variants can't auto-graduate. */
export const TEST_TRIAL_STRATEGY = "MANUAL" as const;

/* ------------------------------------------------------ R3 API limits */

export const API_POSTS_PER_24H = 100;
export const API_CONTAINERS_PER_24H = 400;
export const MAX_VARIANTS = 5;
export const MIN_VARIANTS = 2;
export const MAX_TEST_BATCHES_PER_WEEK = 2;
/** Variants of one test go out this far apart, in the same window. */
export const VARIANT_STAGGER_MIN = 15;

/* ----------------------------------------------------- R4 winner rule */

/**
 * Score weights. Each ratio is first turned into a percentile (0-1) of his
 * own reference distribution, so "0.6" means "better than 60% of his own
 * trials" for every ratio and the weights compare like with like.
 */
export const SCORE_WEIGHTS = {
  watch: 0.35, // avg watch time / reel length
  hold: 0.25, // 1 - 3s skip rate
  shares: 0.25, // shares / reach
  saves: 0.1, // saves / reach
  likes: 0.05, // likes / reach
} as const;
export type ScoreComponent = keyof typeof SCORE_WEIGHTS;
export const CORE_COMPONENTS: ScoreComponent[] = ["watch", "hold", "shares"];
/** Each variant needs this much reach before it can be judged. */
export const MIN_REACH_PER_VARIANT = 300;
/** Winner must beat the runner-up's score by this fraction. */
export const WIN_MARGIN = 0.2;
/** ...and be best on at least this many of the three core ratios. */
export const MIN_CORE_WINS = 2;
/** Use his trial history as the reference once he has this many trial results. */
export const MIN_TRIAL_REFERENCE = 8;

/* ------------------------------------------------------- R7 cadence */

/** Main (non-trial) reels per week. Trials don't count. */
export const MAIN_REELS_PER_WEEK = 3;
/** Minimum gap between two main reels. */
export const MIN_MAIN_GAP_HOURS = 24;
/** Below this many reels with numbers, fall back to generic best times. */
export const MIN_REELS_FOR_OWN_SLOTS = 15;
/** Generic best local hours when he doesn't have enough data yet. */
export const GENERIC_SLOTS = {
  weekday: [19, 12],
  weekend: [11, 18],
} as const;
/** Only suggest local hours in this range (his data can include 3 am posts). */
export const SLOT_HOUR_RANGE = { min: 7, max: 23 } as const;
/** Don't suggest a slot sooner than this from now. */
export const MIN_LEAD_MINUTES = 45;

/* -------------------------------------------------- R8 double down */

export const DOUBLE_DOWN_RATIO = 1.5;
export const DOUBLE_DOWN_WINDOW_DAYS = 30;
export const FOLLOW_UP_MIN_DAYS = 3;
export const FOLLOW_UP_MAX_DAYS = 7;
export const FORMATS = [
  "tutorial",
  "story",
  "listicle",
  "opinion",
  "behind-the-scenes",
  "before-after",
  "reaction",
  "skit",
  "challenge",
  "other",
] as const;

/* ------------------------------------------------- variant rendering */

/**
 * Where the burned-in hook goes by default. "middle" because his reels
 * already carry a title at the top (the hook would sit on top of it);
 * "top" places it under the Reels header.
 */
export const HOOK_POSITION_DEFAULT: "top" | "middle" = "middle";
/** Hook text stays on screen for this long (seconds). */
export const HOOK_OVERLAY_SEC = 3;
/** Fonts tried in order for the burned-in hook (file + Pango family/style). */
export const HOOK_FONTS: Array<{ file: string; pango: string }> = [
  { file: "/System/Library/Fonts/Supplemental/Arial Bold.ttf", pango: "Arial Bold" },
  { file: "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", pango: "Arial Rounded MT Bold" },
  { file: "/System/Library/Fonts/Supplemental/Verdana Bold.ttf", pango: "Verdana Bold" },
  { file: "/Library/Fonts/Arial Bold.ttf", pango: "Arial Bold" },
  { file: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", pango: "DejaVu Sans Bold" },
];
/** Hook text is capped (characters) so it never covers the whole frame. */
export const MAX_HOOK_CHARS = 90;
/** Rendered variant/source files are kept this long after a test ends. */
export const VARIANT_FILE_TTL_DAYS = 14;

export const TEST_VARIABLES = [
  "hook",
  "first_frame",
  "cover",
  "caption",
  "length",
] as const;
export type TestVariable = (typeof TEST_VARIABLES)[number];

export const VARIABLE_LABEL: Record<TestVariable, string> = {
  hook: "Hook",
  first_frame: "First frame",
  cover: "Cover",
  caption: "Caption",
  length: "Length",
};

export const EXPERIMENT_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "deciding",
  "decided",
  "no_winner",
  "cancelled",
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const VARIANT_LABELS = ["A", "B", "C", "D", "E"] as const;

export const DAY_MS = 24 * 60 * 60_000;
export const HOUR_MS = 60 * 60_000;
