"use client";

import { useEffect, useRef } from "react";
import { ahumTriangle, critter, props as kitProps } from "@/lib/handdrawn";
import { cn } from "@/lib/utils";

export type CritterKind =
  | "fox"
  | "raccoon"
  | "owl"
  | "otter"
  | "beaver"
  | "parrot"
  | "dog"
  | "elephant";
export type CritterProp = keyof typeof kitProps;

/**
 * One animal per area of DM Desk (keep it the same everywhere):
 * Home + Login = fox (the lead, cap) · Campaigns = beaver (builds, hard hat) ·
 * Inbox Automations = raccoon (ops, laptop) · Inbox = parrot (talking) ·
 * Stats/Overview = owl (checking, clipboard) · Hook Coach = otter (content) ·
 * Settings = elephant (remembers your setup) · Logs/Diagnostics = dog (loyal follow-up).
 */
export const AREA_CRITTER = {
  home: { kind: "fox", props: ["cap"] },
  campaigns: { kind: "beaver", props: ["hardhat"] },
  inboxAutomations: { kind: "raccoon", props: ["laptop"] },
  inbox: { kind: "parrot", props: [] },
  stats: { kind: "owl", props: ["clipboard"] },
  hooks: { kind: "otter", props: [] },
  settings: { kind: "elephant", props: ["mug"] },
  logs: { kind: "dog", props: ["clipboard"] },
} as const satisfies Record<
  string,
  { kind: CritterKind; props: readonly CritterProp[] }
>;
export type Area = keyof typeof AREA_CRITTER;

/** Fills an SVG group with kit markup after mount (critter() picks random blink delays). */
function useInnerSvg(html: string) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
  }, [html]);
  return ref;
}

interface CritterArtProps {
  kind?: CritterKind;
  /** Shortcut: the area's animal and props. */
  area?: Area;
  mood?: "work" | "sleep";
  props?: readonly CritterProp[];
  /** Bob gently: only when the critter is actually busy right now. */
  working?: boolean;
  /** Lift on hover and squeak when poked. */
  pokeable?: boolean;
  className?: string;
}

export function CritterArt({
  kind,
  area,
  mood = "work",
  props,
  working = false,
  pokeable = false,
  className,
}: CritterArtProps) {
  const preset = area ? AREA_CRITTER[area] : null;
  const k: CritterKind = kind ?? preset?.kind ?? "fox";
  const p = props ?? preset?.props ?? [];
  const extra = p.map((name) => kitProps[name]()).join("");
  let inner = critter(k, mood, extra);
  if (working) inner = `<g class="bobwork">${inner}</g>`;
  if (pokeable) inner = `<g class="hd-hit"><g>${inner}</g></g>`;
  const ref = useInnerSvg(inner);

  return (
    <svg
      viewBox="-50 -52 100 118"
      className={cn("hd-art", className)}
      aria-hidden="true"
    >
      <g className="sk" ref={ref} />
    </svg>
  );
}

/** Login: the fox with its cap says hi from a speech bubble, the Ahum triangle behind. */
export function LoginScene({ className }: { className?: string }) {
  const html = [
    // the hand-drawn Ahum triangle, as a hill behind
    ahumTriangle(222, 70, 158, 46),
    // ground
    `<path class="ln nf" d="M14,160 C80,156 160,163 230,158 C262,156 290,160 306,159"/>`,
    // speech bubble: a DM
    `<path class="ln muz" d="M28,30 C26,16 40,10 74,11 C104,12 118,16 117,31 C116,45 104,50 76,50 L64,50 L52,62 L54,50 C36,50 29,44 28,30 Z"/>`,
    `<text class="svgt" x="50" y="38">hi!</text>`,
    // the fox, front and centre
    `<g class="hd-hit"><g transform="translate(112,96)">${critter("fox", "work", kitProps.cap())}</g></g>`,
  ].join("");
  const ref = useInnerSvg(html);
  return (
    <svg viewBox="0 0 320 172" className={cn("hd-art", className)} aria-hidden="true">
      <g className="sk" ref={ref} />
    </svg>
  );
}

/** The Ahum Labs triangle, hand-drawn, as a small mark. */
export function AhumMark({ className }: { className?: string }) {
  const ref = useInnerSvg(ahumTriangle(30, 6, 54, 26));
  return (
    <svg viewBox="0 0 60 60" className={cn("hd-art", className)} aria-hidden="true">
      <g className="sk" ref={ref} />
    </svg>
  );
}
