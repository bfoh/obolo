import Link from "next/link";
import { isMasked, money, qty as formatQty } from "@/lib/format";
import type { StockLevelRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/**
 * Stock at one location.
 *
 * The cost columns are dropped from the markup entirely for a staff caller
 * rather than hidden with CSS -- the view sends null, so there is nothing to
 * hide, and rendering an empty column would only advertise that something is
 * being withheld.
 */
export function StockTable({
  rows,
  locationId,
  showsCost,
}: {
  rows: StockLevelRow[];
  locationId: string;
  showsCost: boolean;
}) {
  return (
    <div className="rule overflow-x-auto bg-panel">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-line bg-panel-sunk">
            <th scope="col" className="micro px-4 py-2.5">Product</th>
            <th scope="col" className="micro px-4 py-2.5 text-right">On hand</th>
            {showsCost ? (
              <>
                <th scope="col" className="micro px-4 py-2.5 text-right">Unit cost</th>
                <th scope="col" className="micro px-4 py-2.5 text-right">Value</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const low =
              row.reorder_point !== null && Number(row.qty_on_hand) <= Number(row.reorder_point);

            return (
              <tr key={row.product_id} className="border-b border-hairline last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/stock/${row.product_id}?location=${locationId}`}
                    className="block min-h-11 py-1"
                  >
                    <span className="block truncate text-sm text-ink">{row.product_name}</span>
                    <span className="code block truncate">{row.sku}</span>
                  </Link>
                </td>

                <td className="px-4 py-2.5 text-right align-top">
                  <span className={cn("numeric text-sm", low ? "text-warn" : "text-ink")}>
                    {formatQty(row.qty_on_hand)}
                  </span>
                  <span className="code block">{row.base_unit}</span>
                  {low ? (
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-warn">
                      Low
                    </span>
                  ) : null}
                </td>

                {showsCost ? (
                  <>
                    <td className="numeric px-4 py-2.5 text-right align-top text-sm text-ink-2">
                      {isMasked(row.avg_unit_cost) ? "—" : money(row.avg_unit_cost)}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right align-top text-sm text-ink">
                      {money(row.total_cost_value)}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
