"use client";

import type { KeyboardEvent } from "react";

/**
 * Lets a suggested message (shown as the placeholder) be accepted in one
 * action: Tab on desktop, or the "Use this" link on a phone.
 * Only acts while the field is empty, so it never overwrites what you typed.
 */
export function tabFill(
  value: string,
  set: (v: string) => void,
  suggestion: string
) {
  return (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !e.shiftKey && !value.trim()) {
      e.preventDefault();
      set(suggestion);
    }
  };
}

export function UseSuggestion({
  value,
  set,
  suggestion,
}: {
  value: string;
  set: (v: string) => void;
  suggestion: string;
}) {
  if (value.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => set(suggestion)}
      className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      Use this <span className="hidden md:inline">(or press Tab)</span>
    </button>
  );
}
