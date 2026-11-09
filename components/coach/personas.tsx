"use client";

import { useState } from "react";
import {
  Check,
  GearSix,
  PencilSimple,
  Plus,
  SpinnerGap,
  Star,
  Trash,
} from "@phosphor-icons/react";
import { gooeyToast } from "@/lib/hd-toast";
import { coachApi } from "@/lib/coach/client";
import type { CoachPersonaData } from "@/lib/coach/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** One tap to switch persona; the gear opens the Personas sheet. */
export function PersonaChips({
  personas,
  selectedId,
  onSelect,
  onOpenSettings,
}: {
  personas: CoachPersonaData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Coach persona"
        className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
      >
        {personas.map((p, i) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={p.description}
              onClick={() => onSelect(p.id)}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center gap-1.5 border-2 px-3 text-sm font-medium transition-colors",
                i % 3 === 0 ? "hr1" : i % 3 === 1 ? "hr2" : "hr3",
                active
                  ? "border-ink bg-owl text-ink"
                  : "border-ink/40 bg-paper2 text-muted-foreground hover:text-foreground"
              )}
            >
              {p.emoji && <span aria-hidden>{p.emoji}</span>}
              {p.name}
              {p.isDefault && (
                <Star
                  weight="fill"
                  className="size-3 text-hd-accent"
                  aria-label="default"
                />
              )}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onOpenSettings}
        aria-label="Edit personas"
        className="shrink-0"
      >
        <GearSix />
      </Button>
    </div>
  );
}

type Draft = {
  name: string;
  emoji: string;
  description: string;
  instructions: string;
};

const EMPTY: Draft = { name: "", emoji: "", description: "", instructions: "" };

function PersonaForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Draft;
  saving: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <div className="flex gap-2">
        <Input
          value={d.emoji}
          onChange={(e) => setD({ ...d, emoji: e.target.value })}
          placeholder="🙂"
          aria-label="Emoji"
          maxLength={8}
          className="w-14 text-center"
        />
        <Input
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          placeholder="Name, e.g. Hook Doctor"
          aria-label="Name"
          maxLength={60}
          required
        />
      </div>
      <Input
        value={d.description}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        placeholder="One line: what this coach focuses on"
        aria-label="Description"
        maxLength={200}
      />
      <Textarea
        value={d.instructions}
        onChange={(e) => setD({ ...d, instructions: e.target.value })}
        placeholder="How should this coach think and talk? (its system prompt)"
        aria-label="Instructions"
        rows={6}
        maxLength={6000}
        required
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !d.name.trim() || !d.instructions.trim()}>
          {saving ? <SpinnerGap className="animate-spin" /> : <Check />}
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Personas settings: edit, add, delete, set default. */
export function PersonaSheet({
  open,
  onOpenChange,
  personas,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personas: CoachPersonaData[];
  onChange: (personas: CoachPersonaData[]) => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ data: CoachPersonaData[] }>, ok: string) {
    setBusy(key);
    try {
      const { data } = await fn();
      onChange(data);
      setEditing(null);
      gooeyToast.success(ok);
    } catch (err) {
      gooeyToast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto border-t-2 border-ink bg-paper sm:mx-auto sm:max-w-xl"
      >
        <SheetHeader className="pb-0">
          <SheetTitle className="font-display text-3xl leading-none">Personas</SheetTitle>
          <SheetDescription>
            Each persona is a coach with its own focus. The starred one is used by default.
          </SheetDescription>
        </SheetHeader>
        <ul className="space-y-2.5 px-4">
          {personas.map((p) => (
            <li key={p.id} className="hr2 border-2 border-ink bg-paper2 p-3">
              {editing === p.id ? (
                <PersonaForm
                  initial={{
                    name: p.name,
                    emoji: p.emoji,
                    description: p.description,
                    instructions: p.instructions,
                  }}
                  saving={busy === p.id}
                  onCancel={() => setEditing(null)}
                  onSave={(d) =>
                    void run(
                      p.id,
                      () => coachApi(`/api/coach/personas/${p.id}`, { method: "PATCH", body: d }),
                      "Persona saved"
                    )
                  }
                />
              ) : (
                <div className="flex items-start gap-2">
                  <span className="text-xl leading-none" aria-hidden>
                    {p.emoji || "🙂"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {p.name}
                      {p.isDefault && (
                        <span className="ml-1.5 text-xs font-normal text-hd-accent">default</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!p.isDefault && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Make ${p.name} the default`}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            p.id,
                            () =>
                              coachApi(`/api/coach/personas/${p.id}`, {
                                method: "PATCH",
                                body: { isDefault: true },
                              }),
                            `${p.name} is the default`
                          )
                        }
                      >
                        <Star />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => setEditing(p.id)}
                    >
                      <PencilSimple />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${p.name}`}
                      disabled={busy !== null || personas.length <= 1}
                      onClick={() => {
                        if (!window.confirm(`Delete "${p.name}"?`)) return;
                        void run(
                          p.id,
                          () => coachApi(`/api/coach/personas/${p.id}`, { method: "DELETE" }),
                          "Persona deleted"
                        );
                      }}
                    >
                      {busy === p.id ? <SpinnerGap className="animate-spin" /> : <Trash />}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
          <li className="pb-4">
            {editing === "new" ? (
              <div className="hr3 border-2 border-dashed border-ink/60 p-3">
                <PersonaForm
                  initial={EMPTY}
                  saving={busy === "new"}
                  onCancel={() => setEditing(null)}
                  onSave={(d) =>
                    void run("new", () => coachApi("/api/coach/personas", { body: d }), "Persona added")
                  }
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setEditing("new")}
              >
                <Plus /> Add a persona
              </Button>
            )}
          </li>
        </ul>
      </SheetContent>
    </Sheet>
  );
}
