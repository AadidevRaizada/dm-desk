"use client";

/**
 * Coach — interactive island for /coach.
 * Persona chips (1 tap to switch, gear opens Personas) -> [Chat | Reels | Saved].
 */

import { useState } from "react";
import { ChatCircleDots, BookmarksSimple, FilmStrip } from "@phosphor-icons/react";
import { HdPageHead } from "@/components/handdrawn/hd-bits";
import { cn } from "@/lib/utils";
import type { HookData } from "@/lib/server/hook-coach";
import type { HookCoachProfileData } from "@/lib/hook-coach-story";
import type {
  ChatSummary,
  CoachPersonaData,
  SavedAnalysis,
} from "@/lib/coach/types";
import { CoachProvider, useCoach } from "@/components/coach/context";
import { PersonaChips, PersonaSheet } from "@/components/coach/personas";
import ChatTab from "@/components/coach/chat-tab";
import SavedTab from "@/components/coach/saved-tab";
import ReelsTab from "@/components/hook-coach";

export type CoachTab = "chat" | "reels" | "saved";

const TABS: Array<{ key: CoachTab; label: string; icon: typeof FilmStrip }> = [
  { key: "chat", label: "Chat", icon: ChatCircleDots },
  { key: "reels", label: "Reels", icon: FilmStrip },
  { key: "saved", label: "Saved", icon: BookmarksSimple },
];

function Segmented({
  value,
  onChange,
  savedCount,
}: {
  value: CoachTab;
  onChange: (t: CoachTab) => void;
  savedCount: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Coach sections"
      className="hr2 grid grid-cols-3 border-2 border-ink bg-wash p-0.5 sm:inline-grid sm:w-auto"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              "hr1 flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm font-medium transition-colors",
              active
                ? "bg-paper2 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon weight={active ? "fill" : "regular"} className="size-4" />
            {t.label}
            {t.key === "saved" && savedCount > 0 && (
              <span className="text-xs opacity-60">{savedCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CoachInner({
  data,
  profile: initialProfile,
  updatedLabel,
  accountId,
  chats,
  initialTab,
}: {
  data: HookData;
  profile: HookCoachProfileData;
  updatedLabel: string;
  accountId: string | null;
  chats: ChatSummary[];
  initialTab: CoachTab;
}) {
  const coach = useCoach();
  const [tab, setTab] = useState<CoachTab>(initialTab);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [profile, setProfile] = useState(initialProfile);
  const persona = coach.personas.find((p) => p.id === coach.personaId);

  return (
    <div className="space-y-4">
      <HdPageHead
        area="hooks"
        title="Coach"
        line={
          <>
            @{data.account.username} · last {data.summary.postCount} posts ·
            updated {updatedLabel}
          </>
        }
      />

      <div className="space-y-1">
        <PersonaChips
          personas={coach.personas}
          selectedId={coach.personaId}
          onSelect={coach.setPersonaId}
          onOpenSettings={() => setSheetOpen(true)}
        />
        {persona?.description && (
          <p className="text-xs text-muted-foreground">{persona.description}</p>
        )}
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        savedCount={coach.analyses.length}
      />

      {/* All tabs stay mounted so a chat or a half-typed idea survives switching. */}
      <div className="pt-1">
        <div role="tabpanel" hidden={tab !== "chat"}>
          <ChatTab initialChats={chats} accountId={accountId} />
        </div>
        <div role="tabpanel" hidden={tab !== "reels"}>
          <ReelsTab data={data} profile={profile} onProfileSaved={setProfile} />
        </div>
        <div role="tabpanel" hidden={tab !== "saved"}>
          <SavedTab posts={data.posts} />
        </div>
      </div>

      <PersonaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        personas={coach.personas}
        onChange={coach.setPersonas}
      />
    </div>
  );
}

export default function CoachApp(props: {
  data: HookData;
  profile: HookCoachProfileData;
  updatedLabel: string;
  accountId: string | null;
  personas: CoachPersonaData[];
  analyses: SavedAnalysis[];
  chats: ChatSummary[];
  initialTab: CoachTab;
}) {
  return (
    <CoachProvider
      initialPersonas={props.personas}
      initialAnalyses={props.analyses}
      accountId={props.accountId}
    >
      <CoachInner
        data={props.data}
        profile={props.profile}
        updatedLabel={props.updatedLabel}
        accountId={props.accountId}
        chats={props.chats}
        initialTab={props.initialTab}
      />
    </CoachProvider>
  );
}
