"use client";

import Link from "next/link";
import { LogOut, Settings, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/*
  The far-right identity: an avatar that opens Settings, the profile page, and
  sign-out. The sidebar keeps the identity block (name + role) but the actions
  live here — one place for "who am I, and how do I leave".
*/
export function UserMenu({
  name,
  role,
  onSignOut,
}: {
  name: string;
  role: string | null;
  onSignOut: () => void;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground ring-offset-background transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initials || "?"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 normal-case tracking-normal">
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className="text-xs text-muted-foreground">{role?.replace(/_/g, " ") ?? "—"}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRound />
            User profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={() => onSignOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
