"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CaretLeft,
  ChatCircleDots,
  MagnifyingGlass,
  PaperPlaneRight,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { gooeyToast } from "@/lib/hd-toast";
import { cn } from "@/lib/utils";
import { coachApi } from "@/lib/coach/client";
import {
  SUGGESTED_PROMPTS,
  type ChatMessageData,
  type ChatSummary,
} from "@/lib/coach/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCoach } from "@/components/coach/context";
import { AnalyzeCard } from "@/components/coach/analyze-card";

/* Tiny formatter: paragraphs, "-" / "1." lists and **bold**. No HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

function Formatted({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="space-y-1 pl-4">
              {lines.map((l, li) => (
                <li key={li} className="list-disc marker:text-muted-foreground">
                  {inline(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-line">
            {inline(block.replace(/^#+\s*/gm, ""))}
          </p>
        );
      })}
    </div>
  );
}

function AnalyzeOffer({ mediaId }: { mediaId: string }) {
  const coach = useCoach();
  const existing = coach.latest("analyze", mediaId);
  const key = `analyze:${mediaId}`;
  if (existing) {
    return (
      <AnalyzeCard
        analysis={existing}
        personas={coach.personas}
        compact
        redoing={coach.busy[key]}
        onRedo={() => void coach.analyze({ mediaId })}
      />
    );
  }
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="hero"
        className="clicky"
        disabled={coach.busy[key]}
        onClick={() => void coach.analyze({ mediaId })}
      >
        {coach.busy[key] ? <SpinnerGap className="animate-spin" /> : <MagnifyingGlass weight="bold" />}
        Analyze this reel
      </Button>
      {coach.errors[key] && <p className="text-xs text-destructive">{coach.errors[key]}</p>}
    </div>
  );
}

function Bubble({ m }: { m: ChatMessageData }) {
  const mine = m.role === "user";
  return (
    <li className={cn("flex flex-col gap-2", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[88%] border-2 border-ink px-3 py-2 text-sm wrap-break-word",
          mine ? "hr1 bg-owl/60 text-foreground" : "hr2 bg-paper2 text-foreground"
        )}
      >
        {mine ? <p className="whitespace-pre-line">{m.content}</p> : <Formatted text={m.content} />}
      </div>
      {!mine && m.data?.analyzeMediaId && (
        <div className="w-full">
          <AnalyzeOffer mediaId={m.data.analyzeMediaId} />
        </div>
      )}
    </li>
  );
}

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ChatTab({
  initialChats,
  accountId,
}: {
  initialChats: ChatSummary[];
  accountId: string | null;
}) {
  const coach = useCoach();
  const [chats, setChats] = useState(initialChats);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const active = chats.find((c) => c.id === activeId) ?? null;
  const accountParam = accountId ? { instagramAccountId: accountId } : {};

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  async function openChat(id: string) {
    setActiveId(id);
    setMessages([]);
    setError(null);
    setLoadingChat(true);
    try {
      const { data } = await coachApi<{ data: ChatMessageData[] }>(`/api/coach/chats/${id}`);
      setMessages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that chat.");
    } finally {
      setLoadingChat(false);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    const optimistic: ChatMessageData = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      if (!activeId) {
        const res = await coachApi<{ chat: ChatSummary; messages: ChatMessageData[] }>(
          "/api/coach/chats",
          { body: { message, personaId: coach.personaId, ...accountParam } }
        );
        setChats((c) => [res.chat, ...c]);
        setActiveId(res.chat.id);
        setMessages(res.messages);
      } else {
        const res = await coachApi<{ messages: ChatMessageData[] }>(
          `/api/coach/chats/${activeId}`,
          { body: { message, personaId: coach.personaId, ...accountParam } }
        );
        setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...res.messages]);
        setChats((c) => {
          const cur = c.find((x) => x.id === activeId);
          return cur
            ? [{ ...cur, updatedAt: new Date().toISOString() }, ...c.filter((x) => x.id !== activeId)]
            : c;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The coach couldn't answer.");
      setDraft(message);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }

  async function deleteChat(id: string) {
    if (!window.confirm("Delete this chat?")) return;
    try {
      await coachApi(`/api/coach/chats/${id}`, { method: "DELETE" });
      setChats((c) => c.filter((x) => x.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  const inChat = activeId !== null || messages.length > 0;
  const personaName = coach.personas.find((p) => p.id === coach.personaId)?.name ?? "Coach";

  const composer = (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send(draft);
      }}
    >
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`Ask ${personaName}… or paste one of your reel links`}
        rows={1}
        maxLength={4000}
        className="max-h-40 min-h-11 flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send(draft);
          }
        }}
        aria-label="Message the coach"
      />
      <Button
        type="submit"
        size="icon-lg"
        variant="hero"
        disabled={!draft.trim() || sending}
        aria-label="Send"
      >
        {sending ? <SpinnerGap className="animate-spin" /> : <PaperPlaneRight weight="fill" />}
      </Button>
    </form>
  );

  if (!inChat) {
    return (
      <div className="space-y-5">
        <div className="hr2 space-y-3 border-2 border-ink bg-card p-3 sm:p-4">
          <p className="font-display text-2xl leading-tight text-foreground">
            Ask {personaName}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void send(p)}
                disabled={sending}
                className="hr1 min-h-9 border-[1.8px] border-ink bg-paper2 px-3 text-sm text-foreground hover:bg-owl/40"
              >
                {p}
              </button>
            ))}
          </div>
          {composer}
          {error && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <section className="space-y-2">
          <h2 className="font-display text-2xl leading-tight text-foreground">Recent chats</h2>
          {chats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No chats yet. Tap a question above to start.
            </p>
          ) : (
            <ul className="space-y-2">
              {chats.map((c) => {
                const persona = coach.personas.find((p) => p.id === c.personaId);
                return (
                  <li key={c.id} className="hr2 flex items-center border-2 border-ink bg-card">
                    <button
                      type="button"
                      onClick={() => void openChat(c.id)}
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <ChatCircleDots weight="fill" className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">
                          {c.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {persona ? `${persona.emoji} ${persona.name} · ` : ""}
                          {timeAgo(c.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mr-1.5 text-muted-foreground"
                      aria-label={`Delete chat ${c.title}`}
                      onClick={() => void deleteChat(c.id)}
                    >
                      <Trash />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
            setError(null);
          }}
        >
          <CaretLeft /> Chats
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {active?.title ?? "New chat"}
        </p>
      </div>

      {loadingChat ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {sending && (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerGap className="size-4 animate-spin" /> {personaName} is thinking…
            </li>
          )}
        </ul>
      )}
      {error && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <div ref={endRef} />
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur-sm md:bottom-2">
        {composer}
      </div>
    </div>
  );
}
