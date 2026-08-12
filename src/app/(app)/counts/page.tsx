import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCounts } from "@/lib/data/counts";
import { getLocations } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StartCountPanel } from "./StartCountPanel";
import { formatDateTime, isMasked, money, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Counts" };
export const dynamic = "force-dynamic";

const TONE = { counting: "open", submitted: "open", posted: "done", cancelled: "dead" } as const;

export default async function CountsPage() {
  const [user, counts, locations] = await Promise.all([
    getCurrentUser(),
    getCounts(),
    getLocations(),
  ]);
  const canCount = can(user?.role, "countSubmit");
  const countable = locations.filter((l) => l.kind !== "in_transit");
  const openLocations = new Set(
    counts.filter((c) => c.status === "counting" || c.status === "submitted").map((c) => c.location_id),
  );

  return (
    <>
      <PageHeader
        title="Stock counts"
        actions={
          canCount ? (
            <StartCountPanel locations={countable.filter((l) => !openLocations.has(l.id))} />
          ) : null
        }
      />

      <main className="px-5 py-6">
        {counts.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No counts yet"
            description="Count what is physically on the shelves and compare it with what the system believes. The location freezes while you count, so a variance means something."
            action={
              canCount ? <StartCountPanel locations={countable} openByDefault /> : null
            }
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {counts.map((count) => (
              <li key={count.id}>
                <Link
                  href={`/counts/${count.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="numeric">{count.count_no}</span>
                      <StatusBadge tone={TONE[count.status]}>{count.status}</StatusBadge>
                    </p>
                    <p className="code mt-0.5 truncate">
                      {count.location_name} · {formatDateTime(count.frozen_at)}
                      {count.started_by_name ? ` · ${count.started_by_name}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="numeric text-sm text-ink">
                      {count.counted_count}/{count.line_count}
                    </p>
                    {count.variance_count > 0 ? (
                      <p className="code text-warn">{plural(count.variance_count, "variance", "variances")}</p>
                    ) : null}
                    {!isMasked(count.variance_value) && count.status === "posted" ? (
                      <p className="code">{money(count.variance_value)}</p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
