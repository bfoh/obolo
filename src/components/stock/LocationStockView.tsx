import { PackageSearch } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocationByCode, getStockLevels } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StockTable } from "./StockTable";
import { StockSearch } from "./StockSearch";
import { isMasked, money, qty as formatQty } from "@/lib/format";

/**
 * Shared body for the warehouse and shop stock screens. Both show the same
 * thing at a different location; the only difference is which one.
 */
export async function LocationStockView({
  code,
  search,
}: {
  code: "WH" | "SHOP";
  search?: string;
}) {
  const [user, location] = await Promise.all([getCurrentUser(), getLocationByCode(code)]);

  // getLocationByCode reads v_locations, which only returns locations the
  // caller may access -- so a missing row here means "not yours", not "gone".
  if (!location) notFound();

  const rows = await getStockLevels(location.id, search);
  const showsCost = can(user?.role, "cost");

  const totalUnits = rows.reduce((sum, row) => sum + Number(row.qty_on_hand), 0);
  const totalValue = showsCost
    ? rows.reduce((sum, row) => sum + Number(row.total_cost_value ?? 0), 0)
    : null;

  return (
    <>
      <PageHeader title={location.name} code={location.code} />

      <main className="px-5 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <dl className="flex gap-6">
            <div>
              <dt className="micro">Products</dt>
              <dd className="numeric mt-1 text-lg text-ink">{rows.length}</dd>
            </div>
            <div>
              <dt className="micro">Units</dt>
              <dd className="numeric mt-1 text-lg text-ink">{formatQty(totalUnits)}</dd>
            </div>
            {isMasked(totalValue) ? null : (
              <div>
                <dt className="micro">Value</dt>
                <dd className="numeric mt-1 text-lg text-ink">{money(totalValue)}</dd>
              </div>
            )}
          </dl>

          <div className="w-full sm:w-72">
            <StockSearch placeholder="Search name or SKU" />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={search ? "Nothing matches that search" : "No stock here"}
            description={
              search
                ? "Try a different product name or SKU."
                : `Nothing is currently held at ${location.name}.`
            }
          />
        ) : (
          <StockTable rows={rows} locationId={location.id} showsCost={showsCost} />
        )}
      </main>
    </>
  );
}
