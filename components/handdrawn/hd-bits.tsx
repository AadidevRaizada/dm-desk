import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CritterArt, type Area } from "./critter-art";

/**
 * Page heading: Gochi Hand title, one plain line, the area's animal beside it.
 * The critter only blinks; nothing moves next to the words.
 */
export function HdPageHead({
  area,
  title,
  line,
  actions,
  className,
}: {
  area: Area;
  title: ReactNode;
  line?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <CritterArt area={area} pokeable className="size-16 shrink-0 sm:size-20" />
        <div className="min-w-0">
          <h1 className="font-display text-4xl leading-none sm:text-5xl">
            {title}
          </h1>
          {line ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{line}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** Empty state: a sleeping critter and a friendly line. */
export function HdEmpty({
  area,
  title,
  line,
  action,
  mood = "sleep",
  className,
}: {
  area: Area;
  title: ReactNode;
  line?: ReactNode;
  action?: ReactNode;
  mood?: "work" | "sleep";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "hr2 flex flex-col items-center gap-2 border-2 border-dashed border-ink/60 bg-paper2 px-6 py-8 text-center",
        className,
      )}
    >
      <CritterArt area={area} mood={mood} pokeable className="w-28" />
      <p className="font-display text-2xl leading-tight">{title}</p>
      {line ? (
        <p className="max-w-sm text-sm text-muted-foreground">{line}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** "Done!" style stamp for a success moment. */
export function HdStamp({ children }: { children: ReactNode }) {
  return <span className="hd-stamp">{children}</span>;
}
