"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { navGroupsFor } from "@/lib/nav";
import type { Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { GyeNyame } from "@/components/brand/GyeNyame";
import { ThemeToggle } from "./ThemeToggle";
import { SignOutButton } from "./SignOutButton";

const GROUP_LABEL: Record<string, string> = {
  stock: "Stock",
  trade: "Trade",
  control: "Control",
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideRail({
  role,
  fullName,
  companyName,
}: {
  role: Role;
  fullName: string;
  companyName: string;
}) {
  const pathname = usePathname();
  const groups = navGroupsFor(role);

  return (
    // The rail stays dark in both themes: it reads as gantry signage bolted to
    // the building rather than as another panel that follows the room lights.
    <nav
      aria-label="Main"
      className="hidden md:flex w-60 shrink-0 flex-col bg-bitumen-900 dark:bg-bitumen-950 border-r-2 border-bitumen-700"
    >
      <div className="px-5 py-5 border-b-2 border-bitumen-700">
        <span className="flex items-center gap-2.5">
          {/* Concrete rather than an accent: every accent in this palette
              already means something about stock, and the mark reads as one
              unit with the wordmark this way. */}
          <GyeNyame className="h-7 w-auto shrink-0 text-concrete-50" />
          <span className="font-display text-2xl font-extrabold tracking-tight text-concrete-50">
            OBOLO
          </span>
        </span>
        <span className="code mt-1 block truncate text-concrete-400" title={companyName}>
          {companyName}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar py-4">
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-5">
            <p className="micro px-5 pb-2 text-concrete-500">{GROUP_LABEL[group]}</p>
            <ul>
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 border-l-[3px] px-5 py-2.5 text-sm transition-colors",
                        active
                          ? "border-signal-500 bg-bitumen-800 font-medium text-concrete-50"
                          : "border-transparent text-concrete-300 hover:bg-bitumen-800 hover:text-concrete-50",
                      )}
                    >
                      <Icon size={17} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t-2 border-bitumen-700 px-5 py-4">
        <p className="truncate text-sm text-concrete-100">{fullName}</p>
        <p className="code mt-0.5 text-concrete-500">{role.replace("_", " ")}</p>
        <div className="mt-3 flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/password"
            aria-label="Change your password"
            title="Change your password"
            className="flex h-9 w-9 items-center justify-center border-2 border-bitumen-700 text-concrete-300 transition-colors hover:text-signal-400"
          >
            <KeyRound size={16} aria-hidden />
          </Link>
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}
