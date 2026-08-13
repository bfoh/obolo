import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCount, getCountLines } from "@/lib/data/counts";
import { getCurrentUser } from "@/lib/auth";
import { can, hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CountSheet } from "./CountSheet";
import { VarianceReview } from "./VarianceReview";
import { formatDateTime, isMasked, money, qty as formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE = { counting: "open", submitted: "open", posted: "done", cancelled: "dead" } as const;

export async function generateMetadata({ params }: PageProps<"/counts/[id]">): Promise<Metadata> {
  const { id } = await params;
  const count = await getCount(id);
  return { title: count?.count_no ?? "Count" };
}

export default async function CountPage({ params }: PageProps<"/counts/[id]">) {
  const { id } = await params;
  const [user, count] = await Promise.all([getCurrentUser(), getCount(id)]);

  if (!count) notFound();

  const lines = await getCountLines(id);
  const owner = hasFullAccess(user?.role);
  const canCount = can(user?.role, "countSubmit");

  return (
    <>
      <PageHeader
        title={count.count_no}
        code={`${count.location_name} · frozen ${formatDateTime(count.frozen_at)}`}
        actions={<StatusBadge tone={TONE[count.status]}>{count.status}</StatusBadge>}
      />

      <main className="px-5 py-6">
        <dl className="rule mb-5 flex flex-wrap gap-x-8 gap-y-3 bg-panel p-4">
          <div>
            <dt className="micro">Counted</dt>
            <dd className="numeric mt-1 text-sm text-ink">
              {count.counted_count} of {count.line_count}
            </dd>
          </div>
          <div>
            <dt className="micro">Variances</dt>
            <dd className="numeric mt-1 text-sm text-ink">{count.variance_count}</dd>
          </div>
          {!isMasked(count.variance_value) ? (
            <div>
              <dt className="micro">Variance value</dt>
              <dd
                className={`numeric mt-1 text-sm ${
                  Number(count.variance_value) < 0 ? "text-signal" : "text-ink"
                }`}
              >
                {money(count.variance_value)}
              </dd>
            </div>
          ) : null}
          {count.submitted_by_name ? (
            <div>
              <dt className="micro">Submitted by</dt>
              <dd className="mt-1 text-sm text-ink">{count.submitted_by_name}</dd>
            </div>
          ) : null}
        </dl>

        {count.status === "counting" && canCount ? (
          <CountSheet countId={id} lines={lines} />
        ) : count.status === "submitted" ? (
          <VarianceReview countId={id} count={count} lines={lines} canPost={owner} />
        ) : (
          <section className="rule bg-panel">
            <div className="border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Result
              </h2>
            </div>
            <ul className="divide-y divide-hairline">
              {lines
                .filter((line) => Number(line.variance_qty) !== 0)
                .map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{line.product_name}</p>
                      <p className="code truncate">
                        system {formatQty(line.system_qty)} · counted {formatQty(line.counted_qty)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`numeric text-sm ${
                          Number(line.variance_qty) < 0 ? "text-signal" : "text-tally"
                        }`}
                      >
                        {Number(line.variance_qty) > 0 ? "+" : ""}
                        {formatQty(line.variance_qty)}
                      </p>
                      {!isMasked(line.variance_value) ? (
                        <p className="code">{money(line.variance_value)}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              {lines.every((line) => Number(line.variance_qty) === 0) ? (
                <li className="px-4 py-6 text-sm text-ink-3">
                  Everything counted matched the system exactly.
                </li>
              ) : null}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
