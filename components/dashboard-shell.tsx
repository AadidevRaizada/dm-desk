"use client";

import AppSidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import MobileTabBar from "@/components/mobile-tab-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

export interface ShellWorkspace {
  id: string;
  name: string;
  role: string;
}

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  workspaceId: string;
  workspaces: ShellWorkspace[];
  instagramUsername: string | null;
  instagramAccountCount: number;
  /** Initial open state derived from the `sidebar_state` cookie on the server. */
  defaultOpen?: boolean;
}

export default function DashboardShell({
  children,
  workspaceName,
  workspaceId,
  workspaces,
  instagramUsername,
  instagramAccountCount,
  defaultOpen = true,
}: DashboardShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <TooltipProvider>
        <AppSidebar
          workspaceName={workspaceName}
          workspaceId={workspaceId}
          workspaces={workspaces}
        />
        <SidebarInset>
          <TopBar
            instagramUsername={instagramUsername}
            instagramAccountCount={instagramAccountCount}
          />
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 pb-28 md:pb-8 lg:p-8">
            {children}
          </div>
        </SidebarInset>
        {/* Outside <main> on purpose: a fixed bar must not share a subtree with
            page content that may get transforms/filters (iOS Safari repaint bug). */}
        <MobileTabBar />
      </TooltipProvider>
    </SidebarProvider>
  );
}
