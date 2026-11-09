import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

function instagramGraphBase() {
  return `https://graph.instagram.com/${getMetaGraphApiVersion()}`;
}

// Token endpoints are unversioned: graph.instagram.com/v26.0/access_token
// answers "Unsupported request - method type: get" (code 100).
function facebookGraphBase() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export class MetaApiError extends Error {
  constructor(
    public code: number,
    public subcode: number | undefined,
    public fbTraceId: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export class TokenExpiredError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(190, undefined, fbTraceId, message);
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(368, undefined, fbTraceId, message);
    this.name = "RateLimitError";
  }
}

export class PermissionError extends MetaApiError {
  constructor(message: string, fbTraceId?: string) {
    super(100, undefined, fbTraceId, message);
    this.name = "PermissionError";
  }
}

export class MessagingWindowClosedError extends MetaApiError {
  constructor(message: string, fbTraceId?: string, subcode?: number) {
    super(10, subcode ?? 2534022, fbTraceId, message);
    this.name = "MessagingWindowClosedError";
  }
}

interface GraphApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface InstagramUser {
  id: string;
  // Instagram professional account ID. This — not `id` (the app-scoped ID) —
  // is what appears as entry.id in webhooks and is used by the messaging API.
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  // Current follower total. Point-in-time only — Instagram exposes no history
  // for this field, so long-run trends come from FollowerSnapshot instead.
  followers_count?: number;
}

export interface InstagramComment {
  id: string;
  text: string;
  from?: {
    id: string;
    username?: string;
  };
  timestamp: string;
  // Present when the comments query asks for replies{from}. Used to tell whether
  // the account owner has already replied to this comment.
  replies?: {
    data?: { id: string; from?: { id: string; username?: string } }[];
  };
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

/**
 * Per-media insight values. Every requested metric is present as a key; a
 * metric Meta didn't return a value for (not available for this media, still
 * processing, or hidden) is `null`, never 0, so callers can tell "no data"
 * from a real zero.
 */
export interface InstagramMediaInsights {
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  saved?: number | null;
  shares?: number | null;
  total_interactions?: number | null;
  /** Reels only, milliseconds. */
  ig_reels_avg_watch_time?: number | null;
  /** Reels only; Meta documents a percentage (0-100). */
  reels_skip_rate?: number | null;
  [metric: string]: number | null | undefined;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    const message = err?.message ?? "Unknown Meta API error";

    // Instagram's 24-hour messaging window refusal is code 10 subcode 2534022
    // with message "...outside of allowed window...". Treat it as a distinct
    // error so callers can return 403 + a human explanation instead of 502.
    if (
      code === 10 &&
      (subcode === 2534022 || /outside of allowed window/i.test(message))
    ) {
      throw new MessagingWindowClosedError(message, traceId, subcode);
    }
    // Fallback: some payloads omit the subcode but still carry the window text
    if (/outside of allowed window/i.test(message)) {
      throw new MessagingWindowClosedError(message, traceId, subcode);
    }

    switch (code) {
      case 190:
        throw new TokenExpiredError(message, traceId);
      case 368:
      case 4:
      case 17:
        throw new RateLimitError(message, traceId);
      case 10:
      case 100:
      case 200:
        throw new PermissionError(message, traceId);
      default:
        throw new MetaApiError(code, subcode, traceId, message);
    }
  }

  return data as T;
}

export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a private reply to a comment as a button template — an opening message
 * plus a postback button. Tapping the button opens the conversation and fires
 * a `messaging_postbacks` webhook carrying `payload`, which we use to deliver
 * the follow-up ("reveal") message.
 */
export async function sendPrivateReplyWithButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              // Button template text is capped at 640 chars by Meta.
              text: text.slice(0, 640),
              buttons: [
                { type: "postback", title: buttonTitle.slice(0, 20), payload },
              ],
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a direct message (to a user's IGSID) as a button template with a single
 * postback button. Used to re-prompt a user during follow-gating, so tapping
 * the button fires another `messaging_postbacks` webhook carrying `payload`.
 */
export async function sendDirectMessageWithButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttonTitle: string,
  payload: string
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: text.slice(0, 640),
              buttons: [
                { type: "postback", title: buttonTitle.slice(0, 20), payload },
              ],
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Check whether a user (by their IGSID) follows the business account, via the
 * Instagram Messaging profile API. Available for users in an active
 * conversation (e.g. after a private reply or a button tap). Returns true or
 * false, or `null` when Meta does not return the field — so callers can decide
 * how to treat the unverifiable case.
 */
export async function getUserFollowStatus(
  accessToken: string,
  recipientId: string
): Promise<boolean | null> {
  const url = new URL(`${instagramGraphBase()}/${recipientId}`);
  url.searchParams.set("fields", "is_user_follow_business");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.is_user_follow_business === "boolean"
      ? data.is_user_follow_business
      : null;
  } catch {
    return null;
  }
}

/**
 * A tappable web_url button in a DM button template. Instagram's button
 * template supports up to 3 buttons; titles are capped at 20 chars by Meta.
 */
export interface LinkButton {
  title: string;
  url: string;
}

function toWebUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) }));
}

/**
 * Send a private reply to a comment as a button template with up to 3 web_url
 * buttons — the reveal message plus tappable link buttons (for campaigns with
 * no opening DM, where the reveal is delivered straight to the comment).
 */
export async function sendPrivateReplyWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttons: LinkButton[]
): Promise<{ recipient_id: string; message_id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: text.slice(0, 640),
              buttons: toWebUrlButtons(buttons),
            },
          },
        },
      }),
    }
  );

  return handleResponse(response);
}

/**
 * Send a plain-text direct message to a user by their Instagram-scoped ID.
 * Used to deliver the reveal message after a button postback and for manual
 * inbox replies.
 *
 * Pass `opts.tag = "HUMAN_AGENT"` to send outside the 24-hour Standard
 * Messaging Window (up to 7 days) — requires the Human Agent feature to be
 * approved in App Review. The tag must never be used for promotional content.
 */
export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  message: string,
  opts?: { tag?: string }
): Promise<{ recipient_id: string; message_id: string }> {
  const body: Record<string, unknown> = {
    recipient: { id: userId },
    message: { text: message },
  };
  if (opts?.tag) body.tag = opts.tag;

  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    }
  );

  return handleResponse(response);
}

/**
 * Send a direct message as a button template with up to 3 web_url buttons —
 * the reveal message plus tappable link buttons (cleaner than inline URLs).
 */
export async function sendDirectMessageWithLinkButton(
  accessToken: string,
  instagramAccountId: string,
  userId: string,
  text: string,
  buttons: LinkButton[],
  opts?: { tag?: string }
): Promise<{ recipient_id: string; message_id: string }> {
  const body: Record<string, unknown> = {
    recipient: { id: userId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text.slice(0, 640),
          buttons: toWebUrlButtons(buttons),
        },
      },
    },
  };
  if (opts?.tag) body.tag = opts.tag;

  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    }
  );

  return handleResponse(response);
}

export async function sendCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${commentId}/replies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );

  return handleResponse(response);
}

export async function getMediaComments(
  accessToken: string,
  mediaId: string
): Promise<InstagramComment[]> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  url.searchParams.set("fields", "id,text,from,timestamp");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramComment[] }>(response);
  return data.data;
}

/**
 * Recent comments on a media, newest first, each with its replies so the caller
 * can tell whether the account owner has already responded. Pagination stops as
 * soon as it reaches comments older than `sinceMs` (or the `max` ceiling), so a
 * viral post's entire back-catalogue is never pulled — only what is recent
 * enough to still act on. This is what the polling reconciler reads.
 *
 * Note: comments hidden by Instagram's Hidden Words / spam filter may not be
 * returned by the Graph API at all. Disable that filter on the account to widen
 * results.
 */
export async function getRecentMediaComments(
  accessToken: string,
  mediaId: string,
  sinceMs: number,
  max = 800
): Promise<InstagramComment[]> {
  const results: InstagramComment[] = [];

  const first = new URL(`${instagramGraphBase()}/${mediaId}/comments`);
  first.searchParams.set("fields", "id,text,timestamp,from,replies{from}");
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramComment[];
      paging?: { next?: string };
    }>(response);
    const data = page.data ?? [];
    results.push(...data);

    // Newest-first, so once the last item on a page predates the window there
    // is nothing older worth fetching.
    const oldest = data[data.length - 1];
    if (oldest?.timestamp && Date.parse(oldest.timestamp) < sinceMs) break;
    nextUrl = page.paging?.next ?? null;
  }

  return results
    .filter((c) => !c.timestamp || Date.parse(c.timestamp) >= sinceMs)
    .slice(0, max);
}

// --- Direct message inbox (Conversations API) ---------------------------

export interface InstagramParticipant {
  id: string;
  username?: string;
}

export interface InstagramMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: InstagramParticipant;
  to?: { data: InstagramParticipant[] };
}

export interface InstagramConversation {
  id: string;
  updated_time?: string;
  participants?: { data: InstagramParticipant[] };
  messages?: { data: InstagramMessage[] };
}

/**
 * List the account's DM conversations, newest first, each with its participants
 * and a one-message preview. `igUserId` is the account's professional user_id
 * (the same id used to send messages and as webhook entry.id).
 */
export async function getConversations(
  accessToken: string,
  igUserId: string
): Promise<InstagramConversation[]> {
  const url = new URL(`${instagramGraphBase()}/${igUserId}/conversations`);
  url.searchParams.set("platform", "instagram");
  url.searchParams.set(
    "fields",
    "participants,updated_time,messages.limit(1){message,from,created_time}"
  );
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramConversation[] }>(response);
  return data.data ?? [];
}

/**
 * The messages in a conversation, with content. Meta only returns full details
 * for the 20 most recent messages, newest first.
 */
export async function getConversationMessages(
  accessToken: string,
  conversationId: string
): Promise<InstagramMessage[]> {
  const url = new URL(`${instagramGraphBase()}/${conversationId}`);
  url.searchParams.set("fields", "messages{id,created_time,from,to,message}");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ messages?: { data: InstagramMessage[] } }>(
    response
  );
  return data.messages?.data ?? [];
}

export async function getUserInfo(accessToken: string): Promise<InstagramUser> {
  const url = new URL(`${instagramGraphBase()}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,followers_count"
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  return handleResponse<InstagramUser>(response);
}

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count";

// Fields for the campaign post picker (all=true). Includes both
// `media_url` and `thumbnail_url` so the grid can render a cover for every
// type: VIDEO/CAROUSEL have `thumbnail_url`, IMAGE has only `media_url`
// (`thumbnail_url` is null for images). The picker uses
// `thumbnail_url ?? media_url` and never mounts a <video> tag.
export const MEDIA_THUMB_FIELDS =
  "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink";

// Instagram caps a single media page at 100 items.
const MEDIA_PAGE_SIZE = 100;

export async function getUserMedia(
  accessToken: string,
  limit = 25
): Promise<InstagramMedia[]> {
  const url = new URL(`${instagramGraphBase()}/me/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data: InstagramMedia[] }>(response);
  return data.data;
}

/**
 * Fetch media by following pagination cursors until `max` items are collected
 * or there are no more pages. Pass a large `max` for an "all time" view; the
 * cap is a safety ceiling so an account with thousands of posts can't spin
 * forever (and so downstream per-media insight calls stay bounded).
 */
export async function getAllUserMedia(
  accessToken: string,
  max = 500,
  fields: string = MEDIA_FIELDS
): Promise<InstagramMedia[]> {
  const results: InstagramMedia[] = [];

  const first = new URL(`${instagramGraphBase()}/me/media`);
  first.searchParams.set("fields", fields);
  first.searchParams.set("limit", String(Math.min(MEDIA_PAGE_SIZE, max)));
  first.searchParams.set("access_token", accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: InstagramMedia[];
      paging?: { next?: string };
    }>(response);
    results.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  return results.slice(0, max);
}

/**
 * Fetch one media object (fresh `media_url`, which is a short-lived CDN link).
 * Used by the Coach reel analyzer to download the video file.
 */
export async function getMediaById(
  accessToken: string,
  mediaId: string,
  fields: string = MEDIA_FIELDS
): Promise<InstagramMedia> {
  const url = new URL(`${instagramGraphBase()}/${encodeURIComponent(mediaId)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse<InstagramMedia>(response);
}

/**
 * Fetch per-media insight metrics (views, reach, saved, shares, etc.).
 *
 * Requires the `instagram_business_manage_insights` permission — accounts
 * connected before that scope was requested will throw a PermissionError.
 * Metric validity varies by media type, so pass only metrics that apply to
 * the given media (e.g. `views` is not valid for image posts on some accounts).
 */
export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  metrics: string[]
): Promise<InstagramMediaInsights> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{
    data?: Array<{
      name: string;
      values?: Array<{ value: number }>;
      total_value?: { value: number };
    }>;
  }>(response);

  return parseMediaInsights(metrics, data.data ?? []);
}

/**
 * Meta returns some metrics as values[0].value and newer ones (e.g.
 * reels_skip_rate) as total_value.value; accept either. Metrics that come
 * back missing or empty are null (exported for tests).
 */
export function parseMediaInsights(
  requested: string[],
  entries: Array<{
    name: string;
    values?: Array<{ value: number }>;
    total_value?: { value: number };
  }> = []
): InstagramMediaInsights {
  const result: InstagramMediaInsights = {};
  for (const name of requested) result[name] = null;
  for (const entry of entries) {
    const raw = entry.values?.[0]?.value ?? entry.total_value?.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    result[entry.name] =
      raw === undefined || raw === null || !Number.isFinite(value) ? null : value;
  }
  return result;
}

/** One day of net follower change, as reported by account insights. */
export interface FollowerCountPoint {
  /** ISO date (YYYY-MM-DD) the change is attributed to. */
  date: string;
  /** Net followers gained (or lost, if negative) that day. */
  delta: number;
}

// Instagram only retains ~30 days of account insights, and rejects windows
// wider than 30 days outright. Stay just inside the limit.
const FOLLOWER_INSIGHT_MAX_DAYS = 30;

/**
 * Fetch the daily net follower change for an account.
 *
 * Requires `instagram_business_manage_insights`. Note this metric is *not*
 * universally available: Instagram omits it for accounts under 100 followers
 * and it is unsupported on some account types. Callers must treat `null` as
 * "no series available" rather than an error — see the backfill in
 * `lib/reports/follower-history.ts`.
 *
 * Returns daily deltas, not running totals. Reconstruct absolute counts by
 * anchoring on a known `followers_count` and walking backwards.
 */
export async function getFollowerCountSeries(
  accessToken: string,
  instagramAccountId: string,
  days: number = FOLLOWER_INSIGHT_MAX_DAYS
): Promise<FollowerCountPoint[] | null> {
  const span = Math.min(Math.max(days, 1), FOLLOWER_INSIGHT_MAX_DAYS);
  const until = Math.floor(Date.now() / 1000);
  const since = until - (span - 1) * 86_400;

  const url = new URL(`${instagramGraphBase()}/${instagramAccountId}/insights`);
  url.searchParams.set("metric", "follower_count");
  url.searchParams.set("period", "day");
  url.searchParams.set("since", String(since));
  url.searchParams.set("until", String(until));
  url.searchParams.set("access_token", accessToken);

  try {
    const response = await fetch(url.toString());
    const data = await handleResponse<{
      data: Array<{
        name: string;
        values: Array<{ value: number; end_time?: string }>;
      }>;
    }>(response);

    const metric = data.data.find((d) => d.name === "follower_count");
    if (!metric?.values?.length) return null;

    return metric.values.map((v) => ({
      date: (v.end_time ?? new Date().toISOString()).slice(0, 10),
      delta: v.value ?? 0,
    }));
  } catch (err) {
    // A missing permission is a real signal the caller may want to surface;
    // anything else here means the metric is simply unavailable for this
    // account, which is not worth failing the whole dashboard over.
    if (err instanceof PermissionError) throw err;
    console.warn(
      "[Instagram] follower_count insights unavailable:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", requireEnv("INSTAGRAM_APP_SECRET"));
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<TokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string,
  additionalFields: string[] = []
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${instagramGraphBase()}/${instagramAccountId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subscribed_fields: [...new Set([
          "comments", "messages", "messaging_postbacks", ...additionalFields,
        ])],
      }),
    }
  );

  return handleResponse(response);
}

export async function debugToken(inputToken: string, accessToken: string) {
  const url = new URL(`${facebookGraphBase()}/debug_token`);
  url.searchParams.set("input_token", inputToken);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url.toString());
  return handleResponse(response);
}

/* ------------------------------------------------------------------------
 * Content publishing (Reels) — Instagram API with Instagram Login.
 * Flow: create container → (resumable upload | Meta fetches video_url) →
 * poll status_code until FINISHED → media_publish → read permalink.
 * Needs the instagram_business_content_publish permission.
 * ---------------------------------------------------------------------- */

export interface ReelContainerOptions {
  caption: string;
  shareToFeed: boolean;
  /** Cover frame in milliseconds from the start (ignored when coverUrl set). */
  thumbOffsetMs?: number | null;
  coverUrl?: string | null;
  /** Public HTTPS URL Meta fetches the video from. Omit for a resumable upload. */
  videoUrl?: string | null;
  /** Publish as a trial reel (non-followers first). */
  trialStrategy?: "MANUAL" | "SS_PERFORMANCE" | null;
}

export type ContainerStatusCode =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export interface ContainerStatus {
  id: string;
  status_code: ContainerStatusCode;
  /** Human-readable detail Meta sometimes includes when status_code is ERROR. */
  status?: string;
}

export interface ContentPublishingLimit {
  quota_usage: number;
  config?: { quota_total?: number; quota_duration?: number };
}

/** rupload host for resumable Reels uploads (same API version as the Graph calls). */
export function reelUploadUrl(containerId: string): string {
  return `https://rupload.facebook.com/ig-api-upload/${getMetaGraphApiVersion()}/${containerId}`;
}

/**
 * Step 1: create a REELS media container. With no videoUrl it is created with
 * upload_type=resumable and the bytes go to uploadReelVideo() next.
 */
export async function createReelContainer(
  accessToken: string,
  igUserId: string,
  options: ReelContainerOptions
): Promise<{ id: string; uri?: string }> {
  const body: Record<string, string | boolean | number | Record<string, string>> = {
    media_type: "REELS",
    caption: options.caption,
    share_to_feed: options.shareToFeed,
  };
  if (options.videoUrl) body.video_url = options.videoUrl;
  else body.upload_type = "resumable";
  if (options.trialStrategy) {
    body.trial_params = { graduation_strategy: options.trialStrategy };
  }
  if (options.coverUrl) body.cover_url = options.coverUrl;
  else if (options.thumbOffsetMs && options.thumbOffsetMs > 0)
    body.thumb_offset = Math.round(options.thumbOffsetMs);

  const response = await fetch(`${instagramGraphBase()}/${igUserId}/media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}

/**
 * Step 2 (resumable only): send the video bytes to rupload.facebook.com.
 * `body` may be a Buffer or a web ReadableStream (streamed from disk).
 */
export async function uploadReelVideo(
  accessToken: string,
  containerId: string,
  body: Buffer | ReadableStream<Uint8Array>,
  fileSize: number
): Promise<{ success?: boolean; message?: string }> {
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(fileSize),
      "Content-Type": "application/octet-stream",
    },
    body: body as BodyInit,
  };
  if (!(body instanceof Buffer)) init.duplex = "half";
  const response = await fetch(reelUploadUrl(containerId), init);
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  const parsed = data as {
    success?: boolean;
    message?: string;
    error?: GraphApiError["error"];
    debug_info?: { retriable?: boolean; type?: string; message?: string };
  };
  if (!response.ok || parsed.error || parsed.debug_info) {
    const err = parsed.error;
    const message =
      err?.message ??
      parsed.debug_info?.message ??
      parsed.message ??
      `Upload failed (HTTP ${response.status})`;
    const code = err?.code ?? response.status;
    if (code === 190) throw new TokenExpiredError(message, err?.fbtrace_id);
    if (code === 10 || code === 200) throw new PermissionError(message, err?.fbtrace_id);
    throw new MetaApiError(code, err?.error_subcode, err?.fbtrace_id, `Video upload failed: ${message}`);
  }
  return parsed;
}

/** Step 3: container processing state. Poll until FINISHED / ERROR / EXPIRED. */
export async function getContainerStatus(
  accessToken: string,
  containerId: string
): Promise<ContainerStatus> {
  const url = new URL(`${instagramGraphBase()}/${containerId}`);
  url.searchParams.set("fields", "id,status_code,status");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return handleResponse(response);
}

/** Step 4: publish a FINISHED container. Returns the new IG media id. */
export async function publishMediaContainer(
  accessToken: string,
  igUserId: string,
  creationId: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${instagramGraphBase()}/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ creation_id: creationId }),
    }
  );
  return handleResponse(response);
}

/** Step 5: the public link of a published media object. */
export async function getMediaPermalink(
  accessToken: string,
  mediaId: string
): Promise<string | null> {
  const url = new URL(`${instagramGraphBase()}/${mediaId}`);
  url.searchParams.set("fields", "id,permalink");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleResponse<{ permalink?: string }>(response);
  return data.permalink ?? null;
}

/** API-published posts used in the rolling 24h window (cap: 100). */
export async function getContentPublishingLimit(
  accessToken: string,
  igUserId: string
): Promise<ContentPublishingLimit | null> {
  const url = new URL(
    `${instagramGraphBase()}/${igUserId}/content_publishing_limit`
  );
  url.searchParams.set("fields", "quota_usage,config");
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await handleResponse<{ data?: ContentPublishingLimit[] }>(
    response
  );
  return data.data?.[0] ?? null;
}
