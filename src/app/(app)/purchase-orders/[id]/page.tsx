import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPurchaseOrder, getPurchaseOrderLines } from "@/lib/data/purchasing";
import { searchProducts } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PurchaseOrderDetail } from "./PurchaseOrderDetail";
import { formatDate, isMasked, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE = {
  draft: "draft",
  sent: "open",
  partially_received: "open",
  received: "done",
  closed: "done",
  cancelled: "dead",
} as const;

export async function generateMetadata({
  params,
}: PageProps<"/purchase-orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const po = await getPurchaseOrder(id);
  return { title: po?.po_no ?? "Purchase order" };
}

export default async function PurchaseOrderPage({ params }: PageProps<"/purchase-orders/[id]">) {
  const { id } = await params;
  const [user, po] = await Promise.all([getCurrentUser(), getPurchaseOrder(id)]);

  if (!po) notFound();

  const lines = await getPurchaseOrderLines(id);
  const owner = hasFullAccess(user?.role);
  const editable = po.status === "draft" || po.status === "sent";
  const products = editable && owner ? await searchProducts("", 300) : [];

  return (
    <>
      <PageHeader
        title={po.po_no}
        back={{ href: "/purchase-orders", label: "orders" }}
        code={`${po.supplier_name} · ${po.location_code}`}
        actions={<StatusBadge tone={TONE[po.status]}>{po.status.replace("_", " ")}</StatusBadge>}
      />

      <main className="px-5 py-6">
        <dl className="rule mb-5 flex flex-wrap gap-x-8 gap-y-3 bg-panel p-4">
          {po.ordered_at ? (
            <div>
              <dt className="micro">Ordered</dt>
              <dd className="numeric mt-1 text-sm text-ink">{formatDate(po.ordered_at)}</dd>
            </div>
          ) : null}
          {po.expected_at ? (
            <div>
              <dt className="micro">Expected</dt>
              <dd className="numeric mt-1 text-sm text-ink">{formatDate(po.expected_at)}</dd>
            </div>
          ) : null}
          {isMasked(po.total) ? null : (
            <div>
              <dt className="micro">Order value</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(po.total)}</dd>
            </div>
          )}
          {po.notes ? (
            <div className="min-w-0">
              <dt className="micro">Note</dt>
              <dd className="mt-1 truncate text-sm text-ink">{po.notes}</dd>
            </div>
          ) : null}
        </dl>

        <PurchaseOrderDetail po={po} lines={lines} products={products} canEdit={owner && editable} />
      </main>
    </>
  );
}
