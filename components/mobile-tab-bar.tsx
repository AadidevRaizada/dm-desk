"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartLine,
  ChatCircle,
  Lightning,
  PlusCircle,
  SquaresFour,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  href: string;
  icon: Icon;
  /** Other paths that belong to this tab. */
  also: string[];
}

// Phones: everything is one tap away from these five. Hook Coach lives under Stats,
// DM replies under Automations, Settings in the menu. "Post" (schedule a reel)
// sits in the middle, where a thumb lands.
const tabs: Tab[] = [
  { label: "Home", href: "/dashboard", icon: SquaresFour, also: [] },
  {
    label: "Automate",
    href: "/campaigns",
    icon: Lightning,
    also: ["/automations", "/inbox-automations", "/logs"],
  },
  { label: "Post", href: "/schedule", icon: PlusCircle, also: [] },
  { label: "Inbox", href: "/inbox", icon: ChatCircle, also: [] },
  { label: "Stats", href: "/overview", icon: ChartLine, also: ["/hooks", "/coach"] },
];

const radii = ["hr1", "hr2", "hr3", "hr2", "hr1"];

export default function MobileTabBar() {
  const pathname = usePathname();

  // hd-chrome: own compositor layer + opaque paper so iOS Safari keeps painting
  // the bar during a fast fling (see app/handdrawn.css).
  return (
    <nav
      aria-label="Main"
      className="hd-chrome fixed inset-x-0 bottom-0 z-80 border-t-[2.5px] border-ink bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5 gap-0.5 px-1.5 py-1.5">
        {tabs.map((tab, i) => {
          const active = [tab.href, ...tab.also].some(
            (p) => pathname === p || pathname.startsWith(p + "/"),
          );
          const TabIcon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  radii[i],
                  "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 border-2 font-display text-[14px] leading-none whitespace-nowrap",
                  active
                    ? "border-ink bg-paper2 text-ink"
                    : "border-transparent text-hd-muted",
                )}
              >
                <TabIcon size={24} weight={active ? "fill" : "regular"} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
