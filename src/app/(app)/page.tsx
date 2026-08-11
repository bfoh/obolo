import { PackagePlus } from "lucide-react";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ValueTile } from "@/components/valuation/ValueTile";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Valuation" };

export default async function ValuationPage() {
  const user = await getCurrentUser();
  const showsCost = can(user?.role, "cost");
  const now = new Date();

  // Phase 1 wires these to public.v_stock_levels. The ledger tables they read
  // from do not exist yet, so the page renders its real frame with an empty
  // position rather than inventing numbers.
  const positions = [
    { label: "Warehouse", code: "WH", value: showsCost ? 0 : null, units: 0, skus: 0 },
    { label: "Retail shop", code: "SHOP", value: showsCost ? 0 : null, units: 0, skus: 0 },
    {
      label: "In transit",
      code: "TRANSIT",
      value: showsCost ? 0 : null,
      units: 0,
      skus: 0,
      tone: "transit" as const,
    },
  ];

  return (
    <>
      <PageHeader title="Valuation" code={`As of ${formatDateTime(now)} UTC`} />

      <main className="px-5 py-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {positions.map((position) => (
            <ValueTile key={position.code} {...position} skus={position.skus} />
          ))}
        </div>

        <div className="mt-6">
          <EmptyState
            icon={PackagePlus}
            title="No stock recorded yet"
            description="Receive your first delivery into the warehouse. Every receipt creates a costed batch, and the value above updates as stock moves."
          />
        </div>
      </main>
    </>
  );
}
