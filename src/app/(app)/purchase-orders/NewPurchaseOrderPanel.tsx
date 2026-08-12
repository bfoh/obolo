"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SupplierRow } from "@/lib/data/types";
import { createPurchaseOrder, type ActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Raising…" : "Raise order"}
    </Button>
  );
}

export function NewPurchaseOrderPanel({
  suppliers,
  openByDefault = false,
}: {
  suppliers: SupplierRow[];
  openByDefault?: boolean;
}) {
  const [open, setOpen] = useState(openByDefault);
  const [state, formAction] = useActionState<ActionState, FormData>(createPurchaseOrder, {
    error: null,
  });

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        New order
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          New purchase order
        </h2>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} aria-hidden />
        </Button>
      </div>

      <form action={formAction}>
        <label htmlFor="po_supplier" className="micro mb-2 block">
          Ordering from
        </label>
        <select id="po_supplier" name="supplier_id" required className={field}>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>

        <label htmlFor="expected_at" className="micro mt-4 mb-2 block">
          Expected <span className="normal-case tracking-normal text-ink-3">(optional)</span>
        </label>
        <input id="expected_at" name="expected_at" type="date" className={`numeric ${field}`} />

        <label htmlFor="po_notes" className="micro mt-4 mb-2 block">
          Note <span className="normal-case tracking-normal text-ink-3">(optional)</span>
        </label>
        <input id="po_notes" name="notes" type="text" className={field} />

        <FormError message={state.error} />

        <div className="mt-5">
          <Submit />
        </div>
      </form>
    </div>
  );
}
