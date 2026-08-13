import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { moreNavFor } from "@/lib/nav";
import { PageHeader } from "@/components/ui/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { SignOutButton } from "@/components/shell/SignOutButton";

export const metadata: Metadata = { title: "More" };
export const dynamic = "force-dynamic";

const GROUP_LABEL: Record<string, string> = {
  stock: "Stock",
  trade: "Trade",
  control: "Control",
};

/**
 * Everything the side rail shows, for phones that do not have one.
 *
 * `nav.ts` has referred to this route since the navigation was written -- "at
 * most four, plus the action button; anything beyond that lives behind the More
 * route" -- but it was never built, so below 768px twelve of an owner's sixteen
 * destinations had no entry point at all.
 *
 * It lists every destination, including the four already in the tab bar.
 * Hiding those would make the menu shorter and the app harder to trust: people
 * look for a thing where they last found it, not where a rule says it should
 * no longer be.
 */
export default async function MorePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const groups = moreNavFor(user.role);

  return (
    <>
      <PageHeader title="More" />

      <main className="px-5 py-6">
        <nav aria-label="All destinations" className="flex flex-col gap-5">
          {groups.map(({ group, items }) => (
            <section key={group} className="rule bg-panel">
              <h2 className="micro border-b-2 border-line px-4 py-2.5">{GROUP_LABEL[group]}</h2>
              <ul>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href} className="border-b border-hairline last:border-b-0">
                      <Link
                        href={item.href}
                        // min-h-14 rather than the 44px floor: this is the
                        // screen people use to get anywhere, one-handed.
                        className="flex min-h-14 items-center gap-3.5 px-4 py-2.5 text-ink hover:bg-panel-2"
                      >
                        <Icon size={19} strokeWidth={1.8} className="shrink-0 text-ink-3" aria-hidden />
                        <span className="flex-1 text-sm">{item.label}</span>
                        <ChevronRight size={16} className="shrink-0 text-ink-3" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        {/* Rendered dark on purpose: it is the side rail's footer, which on a
            desktop is the one dark thing on screen. Keeping it dark here means
            the same controls look the same in both shells. */}
        <section className="mt-5 border-2 border-bitumen-700 bg-bitumen-900 p-4 dark:bg-bitumen-950">
          <p className="truncate text-sm text-concrete-100">{user.fullName}</p>
          <p className="code mt-0.5 text-concrete-500">{user.role.replace("_", " ")}</p>

          <Link
            href="/password"
            className="mt-4 flex min-h-11 items-center gap-3 border-2 border-bitumen-700 px-3 text-sm text-concrete-100 hover:border-concrete-500"
          >
            <KeyRound size={16} className="shrink-0 text-concrete-400" aria-hidden />
            Change your password
          </Link>

          <div className="mt-3 flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </section>
      </main>
    </>
  );
}
