"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";
import { mobileNavFor, MORE_HREF } from "@/lib/nav";
import type { Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = mobileNavFor(role);

  // More carries everything that did not fit a tab, which on a phone is most
  // of the app. It is always present: without it the side rail's destinations
  // have no entry point at all below 768px.
  const items = [
    ...tabs,
    { href: MORE_HREF, label: "More", icon: MoreHorizontal },
  ];

  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 h-nav border-t-2 border-bitumen-700 bg-bitumen-900 pb-safe dark:bg-bitumen-950"
    >
      <ul className="flex h-15 items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                // min-h-11 keeps the tap target at 44px, the floor for gloved
                // hands on a phone.
                className={cn(
                  "flex h-full min-h-11 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-signal-400" : "text-concrete-400",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
