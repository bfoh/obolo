"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow, StockLevelRow } from "@/lib/data/types";
import { qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { writeOffStock, type ActionState } from "@/app/(app)/returns/actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? "Writing off…" : "Write off"}
    </Button>
  );
}

/**
 * Stock that broke or expired on the shelf.
 *
 * The reason is required, and the form says why: an unexplained write-off is
 * the first thing anyone auditing the stock will ask about. The database
 * refuses one without it too, so this is a courtesy rather than the control.
 */
export function WriteOffPanel({
  location,
  stock,
}: {
  location: LocationRow;
  stock: StockLevelRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await writeOffStock(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { error: null });

  if (stock.length === 0) return null;

  return (
    <form ref={formRef} action={formAction} className="rule bg-panel p-4">
      <input type="hidden" name="location_id" value={location.id} />

      <div className="flex items-center gap-2">
        <TriangleAlert size={15} className="text-signal" aria-hidden />
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          Write off damaged or expired stock
        </h2>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        Takes it out of {location.name} at what it cost. This cannot be edited afterwards — a
        mistake is corrected by reversing it.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="wo_product" className="micro mb-2 block">
            Product
          </label>
          <select id="wo_product" name="product_id" required className={field}>
            <option value="">Choose…</option>
            {stock.map((row) => (
              <option key={row.product_id} value={row.product_id}>
                {row.product_name} — {formatQty(row.qty_on_hand)} {row.base_unit}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="wo_qty" className="micro mb-2 block">
            How many
          </label>
          <input
            id="wo_qty"
            name="qty"
            type="number"
            min="0.001"
            step="any"
            required
            className={`numeric ${field}`}
          />
        </div>

        <div>
          <label htmlFor="wo_reason" className="micro mb-2 block">
            What happened
          </label>
          <input
            id="wo_reason"
            name="reason"
            type="text"
            required
            placeholder="Crushed in transit"
            className={field}
          />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2.5 text-sm text-ink">
        <input type="checkbox" name="expired" className="h-4 w-4 border-2 border-line accent-[var(--ink)]" />
        These had passed their expiry date
      </label>

      <FormError message={state.error} />

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}
