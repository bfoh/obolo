import { Receipt, Plus } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getSales } from "@/lib/data/sales";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { buttonVariants } from "@/components/ui/Button";
import { formatDate, isMasked, money } from "@/lib/format";

export const metadata: Metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

const PAYMENT_TONE = { paid: "done", partial: "open", unpaid: "draft" } as const;

export default async function SalesPage() {
  const [user, sales] = await Promise.all([getCurrentUser(), getSales()]);
  const canSell = can(user?.role, "wholesaleSale") || can(user?.role, "retailSale");
  const showsCost = can(user?.role, "cost");

  return (
    <>
      <PageHeader
        title="Sales"
        actions={
          canSell ? (
            <Link href="/sales/new" className={buttonVariants({ size: "sm" })}>
              <Plus size={14} aria-hidden />
              New sale
            </Link>
          ) : null
        }
      />

      <main className="px-5 py-6">
        {sales.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No sales yet"
            description="Record what leaves the counter. Stock comes off at what it actually cost, so the margin on every sale is real rather than estimated."
            action={canSell ? <Link href="/sales/new" className={buttonVariants()}>New sale</Link> : null}
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {sales.map((sale) => (
              <li key={sale.id}>
                <Link
                  href={`/sales/${sale.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="numeric">{sale.invoice_no ?? sale.order_no}</span>
                      {sale.status === "draft" ? (
                        <StatusBadge tone="draft">draft</StatusBadge>
                      ) : sale.status === "cancelled" ? (
                        <StatusBadge tone="dead">cancelled</StatusBadge>
                      ) : (
                        <StatusBadge tone={PAYMENT_TONE[sale.payment_status]}>
                          {sale.payment_status}
                        </StatusBadge>
                      )}
                    </p>
                    <p className="code mt-0.5 truncate">
                      {sale.customer_name ?? "Walk-in"} · {sale.channel} ·{" "}
                      {formatDate(sale.occurred_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="numeric text-sm text-ink">{money(sale.total)}</p>
                    {showsCost && !isMasked(sale.gross_profit) ? (
                      <p className="code text-tally">{money(sale.gross_profit)} margin</p>
                    ) : Number(sale.owing) > 0 ? (
                      <p className="code text-warn">{money(sale.owing)} owing</p>
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
