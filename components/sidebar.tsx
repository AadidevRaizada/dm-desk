"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CaretUpDown,
  ChartLine,
  ChatCircle,
  Check,
  Gear,
  ListDashes,
  MagnetStraight,
  Megaphone,
  Pulse,
  Robot,
  SquaresFour,
  type Icon,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { AhumMark } from "@/components/handdrawn/critter-art";

interface NavItem {
  label: string;
  href: string;
  icon: Icon;
}

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Your desk",
    items: [
      { label: "Home", href: "/dashboard", icon: SquaresFour },
      { label: "Inbox", href: "/inbox", icon: ChatCircle },
      { label: "Stats", href: "/overview", icon: ChartLine },
      { label: "Coach", href: "/coach", icon: MagnetStraight },
    ],
  },
  {
    label: "Automations",
    items: [
      { label: "Comment to DM", href: "/campaigns", icon: Megaphone },
      { label: "DM replies", href: "/inbox-automations", icon: Robot },
      { label: "DM log", href: "/logs", icon: ListDashes },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Settings", href: "/settings", icon: Gear },
      { label: "Health check", href: "/diagnostics", icon: Pulse },
    ],
  },
];

function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "WS";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  workspaceName: string;
  workspaceId: string;
  workspaces: Array<{ id: string; name: string; role: string }>;
}

export default function AppSidebar({
  workspaceName,
  workspaceId,
  workspaces,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();
  const [switching, setSwitching] = useState(false);

  async function switchWorkspace(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceId || switching) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: nextWorkspaceId }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Failed to switch workspace");
      }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard");
    } catch (error) {
      console.error("Failed to switch workspace:", error);
      setSwitching(false);
    }
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="DM Desk"
              render={<Link href="/dashboard" />}
            >
              <AhumMark className="size-8 shrink-0" />
              <span className="grid flex-1 truncate text-left font-display text-3xl leading-none">
                DM Desk
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  const NavIcon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={<Link href={item.href} />}
                      >
                        <NavIcon weight={isActive ? "fill" : "regular"} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    aria-label="Switch workspace"
                  />
                }
              >
                <Avatar className="size-8 rounded-full">
                  <AvatarFallback className="rounded-full border-2 border-ink bg-dog font-display text-sm text-ink">
                    {workspaceInitials(workspaceName)}
                  </AvatarFallback>
                </Avatar>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{workspaceName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspaces.length} workspace
                    {workspaces.length === 1 ? "" : "s"}
                  </span>
                </span>
                <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={8}
                className="w-(--anchor-width) min-w-56 rounded-lg"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                </DropdownMenuGroup>
                {workspaces.map((workspace) => {
                  const isActive = workspace.id === workspaceId;
                  return (
                    <DropdownMenuItem
                      key={workspace.id}
                      onClick={() => void switchWorkspace(workspace.id)}
                      disabled={switching}
                      className="gap-2 p-2"
                    >
                      <Avatar className="size-8 rounded-full">
                        <AvatarFallback className="rounded-full border-2 border-ink bg-dog font-display text-sm text-ink">
                          {workspaceInitials(workspace.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">
                          {workspace.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {workspace.role.toLowerCase()}
                        </span>
                      </span>
                      {isActive && <Check className="size-4 shrink-0" />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
