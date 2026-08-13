import { ClipboardList } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getPurchaseOrders } from "@/lib/data/purchasing";
import { getSuppliers } from "@/lib/data/receipts";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NewPurchaseOrderPanel } from "./NewPurchaseOrderPanel";
import { formatDate, isMasked, money, qty as formatQty } from "@/lib/format";

export const metadata: Metadata = { title: "Purchase orders" };
export const dynamic = "force-dynamic";

const TONE = {
  draft: "draft",
  sent: "open",
  partially_received: "open",
  received: "done",
  closed: "done",
  cancelled: "dead",
} as const;

export default async function PurchaseOrdersPage() {
  const [user, orders] = await Promise.all([getCurrentUser(), getPurchaseOrders()]);
  const owner = hasFullAccess(user?.role);
  const suppliers = owner ? await getSuppliers() : [];

  return (
    <>
      <PageHeader
        title="Purchase orders"
        actions={owner && suppliers.length > 0 ? <NewPurchaseOrderPanel suppliers={suppliers} /> : null}
      />

      <main className="px-5 py-6">
        {orders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No orders yet"
            description="Raise an order for what you are buying. When it arrives, the delivery starts pre-filled with what is still outstanding, so the only thing to check is where reality differs."
            action={
              owner && suppliers.length > 0 ? (
                <NewPurchaseOrderPanel suppliers={suppliers} openByDefault />
              ) : null
            }
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/purchase-orders/${order.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="numeric">{order.po_no}</span>
                      <StatusBadge tone={TONE[order.status]}>
                        {order.status.replace("_", " ")}
                      </StatusBadge>
                    </p>
                    <p className="code mt-0.5 truncate">
                      {order.supplier_name}
                      {order.expected_at ? ` · due ${formatDate(order.expected_at)}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {isMasked(order.total) ? null : (
                      <p className="numeric text-sm text-ink">{money(order.total)}</p>
                    )}
                    {Number(order.qty_outstanding) > 0 ? (
                      <p className="code text-warn">
                        {formatQty(order.qty_outstanding)} still to come
                      </p>
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
