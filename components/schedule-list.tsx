"use client";

import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CalendarBlank,
  CircleNotch,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { HdEmpty } from "@/components/handdrawn/hd-bits";
import { formatWhen, useNow } from "@/components/schedule-form";
import { gooeyToast } from "@/lib/hd-toast";
import { RECONNECT_PREFIX } from "@/lib/scheduling/rules";
import type { ScheduledPostView } from "@/lib/scheduling/queries";
import { toLocalInputValue } from "@/lib/scheduling/suggest";
import { cn } from "@/lib/utils";

/** "in 2h 05m" / "in 3d 4h" / "any moment" */
export function countdown(target: number, now: number): string {
  const ms = target - now;
  if (ms <= 60_000) return "any moment";
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${String(m).padStart(2, "0")}m`;
  return `in ${m}m`;
}

async function call(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) return true;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    gooeyToast.error(body.error ?? "That didn't work.");
  } catch {
    gooeyToast.error("No connection. Try again.");
  }
  return false;
}

export default function ScheduleList({
  posts,
  canEdit,
  onChange,
}: {
  posts: ScheduledPostView[];
  canEdit: boolean;
  onChange: () => Promise<void> | void;
}) {
  const now = useNow();
  const hasPublishing = posts.some((p) => p.status === "PUBLISHING");

  // Refresh while something is going out so the row flips to Published.
  useEffect(() => {
    if (!hasPublishing) return;
    const t = setInterval(() => void onChange(), 15_000);
    return () => clearInterval(t);
  }, [hasPublishing, onChange]);

  const upcoming = posts.filter((p) => p.status === "SCHEDULED" || p.status === "PUBLISHING");
  const failed = posts.filter((p) => p.status === "FAILED");
  const published = posts
    .filter((p) => p.status === "PUBLISHED")
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  if (posts.length === 0) {
    return (
      <HdEmpty
        area="hooks"
        title="Nothing scheduled"
        line="Pick a video and a time. The otter posts it for you."
      />
    );
  }

  return (
    <div className="space-y-6">
      {failed.length > 0 ? (
        <Section title="Failed" count={failed.length}>
          {failed.map((p) => (
            <Row key={p.id} post={p}>
              <p className="flex items-start gap-1 text-xs text-destructive">
                <WarningCircle weight="fill" className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-3">
                  {p.error?.replace(RECONNECT_PREFIX, "") ?? "Something went wrong."}
                </span>
              </p>
              {canEdit ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="clicky h-10 flex-1"
                    onClick={async () => {
                      if (await call(`/api/schedule/${p.id}`, { method: "PATCH", body: JSON.stringify({ action: "retry" }) })) {
                        gooeyToast.success("Trying again now");
                        await onChange();
                      }
                    }}
                  >
                    <ArrowClockwise /> Retry
                  </Button>
                  <DeleteButton id={p.id} label="Remove" onDone={onChange} />
                </div>
              ) : null}
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title="Coming up" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing queued.</p>
        ) : (
          upcoming.map((p) => (
            <Row key={p.id} post={p}>
              {p.status === "PUBLISHING" ? (
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <CircleNotch className="size-4 animate-spin" /> Posting now…
                </p>
              ) : (
                <UpcomingActions post={p} now={now} canEdit={canEdit} onChange={onChange} />
              )}
            </Row>
          ))
        )}
      </Section>

      {published.length > 0 ? (
        <Section title="Posted" count={published.length}>
          {published.map((p) => (
            <Row key={p.id} post={p}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {p.publishedAt ? formatWhen(new Date(p.publishedAt)) : ""}
                </p>
                {p.permalink ? (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center gap-1 text-sm font-semibold underline decoration-wavy decoration-hd-accent underline-offset-4"
                  >
                    Open <ArrowSquareOut className="size-4" />
                  </a>
                ) : null}
              </div>
            </Row>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 font-display text-2xl leading-none">
        {title} <span className="text-base text-muted-foreground">{count}</span>
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

function Row({ post, children }: { post: ScheduledPostView; children: React.ReactNode }) {
  const [coverOk, setCoverOk] = useState(post.hasCover);
  return (
    <li className="hr2 flex gap-3 border-2 border-ink bg-card p-3">
      <div className="hr1 aspect-9/16 w-14 shrink-0 overflow-hidden border-2 border-ink bg-paper2">
        {coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/schedule/${post.id}/cover`}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setCoverOk(false)}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">
          {post.caption || <span className="text-muted-foreground">No caption</span>}
        </p>
        <p className="mb-1.5 text-xs text-muted-foreground">
          @{post.username}
          {post.shareToFeed ? "" : " · Reels only"}
          {post.trialStrategy
            ? post.trialStrategy === "MANUAL"
              ? " · Trial (you share it)"
              : " · Trial (auto-share if it does well)"
            : ""}
        </p>
        {children}
      </div>
    </li>
  );
}

function UpcomingActions({
  post,
  now,
  canEdit,
  onChange,
}: {
  post: ScheduledPostView;
  now: number;
  canEdit: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const at = new Date(post.scheduledAt);

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold">{formatWhen(at)}</span>{" "}
        <span className="text-muted-foreground">· {countdown(at.getTime(), now)}</span>
      </p>
      {post.error ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{post.error}</p>
      ) : null}
      {canEdit ? (
        editing ? (
          <div className="flex flex-wrap gap-2">
            <input
              type="datetime-local"
              aria-label="New time"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="hr3 h-10 min-w-0 flex-1 border-2 border-ink bg-paper px-2 text-base"
            />
            <Button
              size="sm"
              className="clicky h-10"
              onClick={async () => {
                const next = new Date(value);
                if (Number.isNaN(next.getTime())) return;
                if (
                  await call(`/api/schedule/${post.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ action: "update", scheduledAt: next.toISOString() }),
                  })
                ) {
                  setEditing(false);
                  gooeyToast.success(`Moved to ${formatWhen(next)}`);
                  await onChange();
                }
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-10" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="clicky h-10 flex-1"
              onClick={() => {
                setValue(toLocalInputValue(at));
                setEditing(true);
              }}
            >
              <CalendarBlank /> Change time
            </Button>
            <DeleteButton id={post.id} label="Cancel post" onDone={onChange} />
          </div>
        )
      ) : null}
    </div>
  );
}

/** Two taps: first arms it ("Sure?"), second deletes. Disarms after 4 s. */
function DeleteButton({
  id,
  label,
  onDone,
}: {
  id: string;
  label: string;
  onDone: () => Promise<void> | void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <Button
      size="sm"
      variant={armed ? "destructive" : "ghost"}
      disabled={busy}
      className={cn("clicky h-10", armed ? "flex-1" : "")}
      aria-label={armed ? `Yes, ${label.toLowerCase()}` : label}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        if (await call(`/api/schedule/${id}`, { method: "DELETE" })) {
          gooeyToast.success(label === "Remove" ? "Removed" : "Cancelled");
          await onDone();
        }
        setBusy(false);
        setArmed(false);
      }}
    >
      <Trash /> {armed ? "Sure?" : label}
    </Button>
  );
}
