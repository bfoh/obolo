"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow, SupplierRow } from "@/lib/data/types";
import { createReceipt, type ActionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { CURRENCY_SYMBOL } from "@/lib/format";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="mt-6 w-full">
      {pending ? "Opening…" : "Open delivery"}
    </Button>
  );
}

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

export function NewReceiptForm({
  locations,
  suppliers,
}: {
  locations: LocationRow[];
  suppliers: SupplierRow[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createReceipt, { error: null });
  const warehouse = locations.find((l) => l.kind === "warehouse");

  return (
    <form action={formAction}>
      <p className="mb-5 text-sm text-ink-3">
        Record what arrived. You will add the lines next, then post it to bring the stock in.
      </p>

      <label htmlFor="location" className="micro mb-2 block">
        Into
      </label>
      <select id="location" name="location_id" defaultValue={warehouse?.id} className={field}>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      <label htmlFor="supplier" className="micro mt-4 mb-2 block">
        Supplier
      </label>
      <select id="supplier" name="supplier_id" className={field} defaultValue="">
        <option value="">Not recorded</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </select>

      <label htmlFor="waybill" className="micro mt-4 mb-2 block">
        Waybill number <span className="normal-case tracking-normal text-ink-3">(optional)</span>
      </label>
      <input id="waybill" name="waybill_no" type="text" className={`numeric ${field}`} />

      <fieldset className="mt-6 border-t border-hairline pt-4">
        <legend className="micro">Delivery charges</legend>
        <p className="mt-2 mb-3 text-sm text-ink-3">
          Freight, clearing and duty are spread across the lines by value, so every batch is valued
          at what it actually landed for — not just the invoice price.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["freight", "Freight"],
              ["duty", "Duty"],
              ["other", "Other"],
            ] as const
          ).map(([name, label]) => (
            <div key={name}>
              <label htmlFor={name} className="micro mb-2 block">
                {label}
              </label>
              <div className="relative">
                <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                  {CURRENCY_SYMBOL}
                </span>
                <input
                  id={name}
                  name={name}
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  className={`numeric ${field} pl-7`}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <FormError message={state.error} />
      <Submit />
    </form>
  );
}
