"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { SignOut } from "@phosphor-icons/react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ModeToggle } from "./theme-toggle";
import SoundToggle from "./handdrawn/sound-toggle";
import { canManageInstagramAccounts, useWorkspaceContext } from "@/lib/workspace-context";

const pageTitles: Record<string, string> = {
  "/dashboard": "Home",
  "/campaigns": "Automations",
  "/campaigns/new": "New automation",
  "/campaigns/import": "Import",
  "/automations": "Automations",
  "/automations/new": "New automation",
  "/inbox-automations": "DM replies",
  "/logs": "DM log",
  "/settings": "Settings",
  "/diagnostics": "Health check",
  "/overview": "Stats",
  "/coach": "Coach",
  "/hooks": "Coach",
  "/inbox": "Inbox",
  "/schedule": "Post a reel",
};

function titleFor(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/campaigns/") || pathname.startsWith("/automations/"))
    return "Automation";
  return "DM Desk";
}

interface TopBarProps {
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title = titleFor(pathname);
  const canManageAccounts = canManageInstagramAccounts(useWorkspaceContext());
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function confirmSignOut() {
    setIsSigningOut(true);
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <header className="hd-chrome sticky top-0 z-80 flex h-14 w-full shrink-0 items-center gap-2 border-b-[2.5px] border-ink bg-paper px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" aria-label="Menu" />
        <Separator
          orientation="vertical"
          className="mr-1 data-[orientation=vertical]:h-5"
        />
        <p className="truncate font-display text-2xl leading-none">{title}</p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        {instagramAccountCount > 0 ? (
          <a
            href={"https://instagram.com/" + instagramUsername}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden max-w-40 shrink-0 truncate text-sm font-semibold underline decoration-wavy decoration-hd-accent underline-offset-4 sm:inline"
          >
            {instagramAccountCount > 1
              ? `${instagramAccountCount} accounts`
              : `@${instagramUsername}`}
          </a>
        ) : canManageAccounts ? (
          <a
            href="/api/instagram/connect"
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "shrink-0 whitespace-nowrap",
            )}
          >
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect Instagram</span>
          </a>
        ) : null}
        <SoundToggle />
        <ModeToggle />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setSignOutOpen(true)}
          aria-label="Sign out"
          title="Sign out"
        >
          <SignOut className="text-muted-foreground" />
        </Button>
      </div>

      <Dialog
        open={signOutOpen}
        onOpenChange={(open) => {
          if (!isSigningOut) setSignOutOpen(open);
        }}
      >
        <DialogContent showCloseButton={!isSigningOut}>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              You will go back to the sign-in page. Nothing else changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSignOutOpen(false)}
              disabled={isSigningOut}
            >
              Stay signed in
            </Button>
            <Button
              type="button"
              onClick={() => void confirmSignOut()}
              disabled={isSigningOut}
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
