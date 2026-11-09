import Link from "next/link";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { CritterArt } from "@/components/handdrawn/critter-art";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Page not found - DM Desk",
  description: "The page you're looking for doesn't exist.",
};

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <CritterArt
          kind="raccoon"
          props={["hardhat"]}
          pokeable
          className="mx-auto w-36"
        />
        <p className="mt-2 font-display text-7xl leading-none">404</p>
        <h1 className="mt-2 font-display text-4xl leading-none">
          This page isn&apos;t here
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The raccoon looked everywhere. Let&apos;s go back home.
        </p>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "default", size: "lg" }), "mt-6")}
        >
          <HouseIcon className="size-4" aria-hidden="true" />
          Go home
        </Link>
      </div>
    </div>
  );
}
