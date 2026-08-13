import { PackagePlus, Plus } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getReceipts } from "@/lib/data/receipts";
import { searchProducts } from "@/lib/data/stock";
import { DocumentIntake } from "@/components/scan/DocumentIntake";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { buttonVariants } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const [user, receipts] = await Promise.all([getCurrentUser(), getReceipts()]);
  // Opening a delivery means entering costs, which is the owner's job.
  const canOpen = hasFullAccess(user?.role);
  const products = canOpen ? await searchProducts("", 300) : [];

  return (
    <>
      <PageHeader
        title="Deliveries"
        actions={
          canOpen ? (
            <Link href="/receive/new" className={buttonVariants({ size: "sm" })}>
              <Plus size={14} aria-hidden />
              New delivery
            </Link>
          ) : null
        }
      />

      <main className="px-5 py-6">
        {canOpen && products.length > 0 ? (
          <div className="mb-5">
            <DocumentIntake products={products} />
          </div>
        ) : null}

        {receipts.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="No deliveries yet"
            description="Record what arrived and what it cost. Freight and duty are spread across the lines, so each batch is valued at what it truly landed for."
            action={
              canOpen ? (
                <Link href="/receive/new" className={buttonVariants()}>
                  New delivery
                </Link>
              ) : null
            }
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {receipts.map((receipt) => (
              <li key={receipt.id}>
                <Link
                  href={`/receive/${receipt.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-ink">
                      <span className="numeric">{receipt.grn_no}</span>
                      <StatusBadge tone={statusTone(receipt.status)}>{receipt.status}</StatusBadge>
                    </p>
                    <p className="code mt-0.5 truncate">
                      {receipt.supplier_name ?? "No supplier"} · {receipt.location_code} ·{" "}
                      {formatDateTime(receipt.received_at)}
                    </p>
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
