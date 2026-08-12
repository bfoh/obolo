import { Truck } from "lucide-react";
import type { Metadata } from "next";
import { getSuppliers } from "@/lib/data/receipts";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewSupplierPanel } from "@/components/catalogue/NewSupplierPanel";
import { plural } from "@/lib/format";

export const metadata: Metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const [user, suppliers] = await Promise.all([getCurrentUser(), getSuppliers()]);
  const canManage = can(user?.role, "suppliers");

  return (
    <>
      <PageHeader
        title="Suppliers"
        code={plural(suppliers.length, "supplier")}
        actions={canManage ? <NewSupplierPanel /> : null}
      />

      <main className="px-5 py-6">
        {suppliers.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            description="Record who you buy from. A delivery can be logged without one, but naming the supplier is what makes a waybill traceable later."
            action={canManage ? <NewSupplierPanel openByDefault /> : null}
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{supplier.name}</p>
                  <p className="code truncate">
                    {supplier.code}
                    {supplier.phone ? ` · ${supplier.phone}` : ""}
                    {supplier.email ? ` · ${supplier.email}` : ""}
                  </p>
                </div>
                {supplier.payment_terms_days > 0 ? (
                  <span className="code shrink-0">{supplier.payment_terms_days}d terms</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
