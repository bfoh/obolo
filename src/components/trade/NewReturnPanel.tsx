"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CustomerRow, LocationRow } from "@/lib/data/types";
import { createReturn, type ActionState } from "@/app/(app)/returns/actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Opening…" : "Start return"}
    </Button>
  );
}

export function NewReturnPanel({
  customers,
  locations,
}: {
  customers: CustomerRow[];
  locations: LocationRow[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createReturn, { error: null });

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        New return
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          New return
        </h2>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} aria-hidden />
        </Button>
      </div>

      <form action={formAction}>
        <label htmlFor="rt_location" className="micro mb-2 block">
          Coming back to
        </label>
        <select id="rt_location" name="location_id" className={field}>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>

        <label htmlFor="rt_customer" className="micro mt-4 mb-2 block">
          Customer <span className="normal-case tracking-normal text-ink-3">(optional)</span>
        </label>
        <select id="rt_customer" name="customer_id" className={field} defaultValue="">
          <option value="">Not recorded</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-3">
          Without a customer there is nobody to credit — the goods come back, but no credit note is
          issued.
        </p>

        <label htmlFor="rt_reason" className="micro mt-4 mb-2 block">
          Why
        </label>
        <input id="rt_reason" name="reason" type="text" placeholder="Wrong size" className={field} />

        <FormError message={state.error} />

        <div className="mt-5">
          <Submit />
        </div>
      </form>
    </div>
  );
}
