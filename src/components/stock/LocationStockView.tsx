import { PackageSearch } from "lucide-react";
import { notFound } from "next/navigation";
import { getLocationByCode, getLocationTotals, getStockLevels } from "@/lib/data/stock";
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

  // Totals come from SQL, not from reducing `rows`: money crosses the wire as
  // text so it stays exact, and summing it in JavaScript would make it float64
  // again. The totals also cover the whole location rather than just the rows
  // a search happens to have matched.
  const [rows, totals] = await Promise.all([
    getStockLevels(location.id, search),
    getLocationTotals(location.id),
  ]);
  const showsCost = can(user?.role, "cost");

  return (
    <>
      <PageHeader title={location.name} code={location.code} />

      <main className="px-5 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <dl className="flex gap-6">
            <div>
              <dt className="micro">Products</dt>
              <dd className="numeric mt-1 text-lg text-ink">{totals.product_count}</dd>
            </div>
            <div>
              <dt className="micro">Units</dt>
              <dd className="numeric mt-1 text-lg text-ink">{formatQty(totals.total_qty)}</dd>
            </div>
            {showsCost && !isMasked(totals.total_value) ? (
              <div>
                <dt className="micro">Value</dt>
                <dd className="numeric mt-1 text-lg text-ink">{money(totals.total_value)}</dd>
              </div>
            ) : null}
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
