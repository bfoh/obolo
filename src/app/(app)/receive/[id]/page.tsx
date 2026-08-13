import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReceipt, getReceiptLines } from "@/lib/data/receipts";
import { searchProducts } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { formatDate, formatDateTime, isMasked, money, qty as formatQty } from "@/lib/format";
import { DraftReceipt } from "./DraftReceipt";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/receive/[id]">): Promise<Metadata> {
  const { id } = await params;
  const receipt = await getReceipt(id);
  return { title: receipt?.grn_no ?? "Delivery" };
}

export default async function ReceiptPage({ params }: PageProps<"/receive/[id]">) {
  const { id } = await params;
  const [user, receipt] = await Promise.all([getCurrentUser(), getReceipt(id)]);

  if (!receipt) notFound();

  const lines = await getReceiptLines(id);
  const isDraft = receipt.status === "draft";
  const products = isDraft && hasFullAccess(user?.role) ? await searchProducts("", 300) : [];

  return (
    <>
      <PageHeader
        title={receipt.grn_no}
        code={`${receipt.supplier_name ?? "No supplier"} · ${receipt.location_code}`}
        actions={<StatusBadge tone={statusTone(receipt.status)}>{receipt.status}</StatusBadge>}
      />

      <main className="px-5 py-6">
        <dl className="rule mb-5 flex flex-wrap gap-x-8 gap-y-3 bg-panel p-4">
          <div>
            <dt className="micro">Received</dt>
            <dd className="numeric mt-1 text-sm text-ink">{formatDateTime(receipt.received_at)}</dd>
          </div>
          {receipt.waybill_no ? (
            <div>
              <dt className="micro">Waybill</dt>
              <dd className="numeric mt-1 text-sm text-ink">{receipt.waybill_no}</dd>
            </div>
          ) : null}
          {isMasked(receipt.charges_total) ? null : (
            <div>
              <dt className="micro">Charges</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(receipt.charges_total)}</dd>
            </div>
          )}
          {receipt.posted_at ? (
            <div>
              <dt className="micro">Posted</dt>
              <dd className="numeric mt-1 text-sm text-ink">{formatDateTime(receipt.posted_at)}</dd>
            </div>
          ) : null}
        </dl>

        {isDraft && hasFullAccess(user?.role) ? (
          <DraftReceipt receipt={receipt} lines={lines} products={products} />
        ) : (
          <section className="rule bg-panel">
            <div className="border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Lines
              </h2>
            </div>
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">Nothing on this delivery.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{line.product_name}</p>
                      <p className="code truncate">
                        {line.sku}
                        {line.lot_code ? ` · ${line.lot_code}` : ""}
                        {line.expiry_date ? ` · exp ${formatDate(line.expiry_date)}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="numeric text-sm text-ink">{formatQty(line.qty_received)}</p>
                      {isMasked(line.landed_unit_cost) ? null : (
                        <p className="code">{money(line.landed_unit_cost)} landed</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}
