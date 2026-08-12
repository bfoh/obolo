import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getSale, getSaleLines } from "@/lib/data/sales";
import { getStockLevels } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DraftSale } from "./DraftSale";
import { formatDate, isMasked, money, qty as formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAYMENT_TONE = { paid: "done", partial: "open", unpaid: "draft" } as const;

export async function generateMetadata({ params }: PageProps<"/sales/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sale = await getSale(id);
  return { title: sale?.invoice_no ?? sale?.order_no ?? "Sale" };
}

export default async function SalePage({ params }: PageProps<"/sales/[id]">) {
  const { id } = await params;
  const [user, sale] = await Promise.all([getCurrentUser(), getSale(id)]);

  if (!sale) notFound();

  const lines = await getSaleLines(id);
  const isDraft = sale.status === "draft";
  const available = isDraft ? await getStockLevels(sale.location_id) : [];
  const showsCost = can(user?.role, "cost");

  return (
    <>
      <PageHeader
        title={sale.invoice_no ?? sale.order_no}
        code={`${sale.customer_name ?? "Walk-in"} · ${sale.channel} · ${sale.location_code}`}
        actions={
          sale.status === "draft" ? (
            <StatusBadge tone="draft">draft</StatusBadge>
          ) : sale.status === "cancelled" ? (
            <StatusBadge tone="dead">cancelled</StatusBadge>
          ) : (
            <StatusBadge tone={PAYMENT_TONE[sale.payment_status]}>{sale.payment_status}</StatusBadge>
          )
        }
      />

      <main className="px-5 py-6">
        {!isDraft ? (
          <dl className="rule mb-5 flex flex-wrap gap-x-8 gap-y-3 bg-panel p-4">
            <div>
              <dt className="micro">Total</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(sale.total)}</dd>
            </div>
            <div>
              <dt className="micro">Paid</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(sale.paid)}</dd>
            </div>
            {Number(sale.owing) > 0 ? (
              <div>
                <dt className="micro">Owing</dt>
                <dd className="numeric mt-1 text-sm text-warn">{money(sale.owing)}</dd>
              </div>
            ) : null}
            {showsCost && !isMasked(sale.gross_profit) ? (
              <>
                <div>
                  <dt className="micro">Cost of goods</dt>
                  <dd className="numeric mt-1 text-sm text-ink">{money(sale.total_cogs)}</dd>
                </div>
                <div>
                  <dt className="micro">Margin</dt>
                  <dd className="numeric mt-1 text-sm text-tally">{money(sale.gross_profit)}</dd>
                </div>
              </>
            ) : null}
            {sale.due_date ? (
              <div>
                <dt className="micro">Due</dt>
                <dd className="numeric mt-1 text-sm text-ink">{formatDate(sale.due_date)}</dd>
              </div>
            ) : null}
            {sale.customer_id ? (
              <div>
                <dt className="micro">Customer</dt>
                <dd className="mt-1 text-sm">
                  <Link href={`/customers/${sale.customer_id}`} className="text-ink underline">
                    {sale.customer_name}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {isDraft ? (
          <DraftSale sale={sale} lines={lines} available={available} />
        ) : (
          <section className="rule bg-panel">
            <div className="border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                What was sold
              </h2>
            </div>
            <ul className="divide-y divide-hairline">
              {lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{line.product_name}</p>
                    <p className="code truncate">
                      {formatQty(line.qty)} {line.base_unit} × {money(line.unit_price)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="numeric text-sm text-ink">{money(line.line_total)}</p>
                    {showsCost && !isMasked(line.margin) ? (
                      <p className="code text-tally">{money(line.margin)} margin</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
