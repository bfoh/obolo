"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCustomer, type ActionState } from "@/app/(app)/sales/actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { CURRENCY_SYMBOL } from "@/lib/format";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Add customer"}
    </Button>
  );
}

export function NewCustomerPanel({ openByDefault = false }: { openByDefault?: boolean }) {
  const [open, setOpen] = useState(openByDefault);
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createCustomer(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, { error: null });

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        New customer
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          New customer
        </h2>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} aria-hidden />
        </Button>
      </div>

      <form action={formAction}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="code" className="micro mb-2 block">
              Short code
            </label>
            <input id="code" name="code" type="text" required placeholder="ADOM-1" className={`numeric ${field}`} />
          </div>
          <div>
            <label htmlFor="customer_name" className="micro mb-2 block">
              Name
            </label>
            <input id="customer_name" name="name" type="text" required className={field} />
          </div>
          <div>
            <label htmlFor="cust_phone" className="micro mb-2 block">
              Phone
            </label>
            <input id="cust_phone" name="phone" type="tel" className={`numeric ${field}`} />
          </div>
          <div>
            <label htmlFor="kind" className="micro mb-2 block">
              Kind
            </label>
            <select id="kind" name="kind" defaultValue="wholesale" className={field}>
              <option value="wholesale">Wholesale</option>
              <option value="retail">Retail</option>
            </select>
          </div>
          <div>
            <label htmlFor="credit_limit" className="micro mb-2 block">
              Credit limit
            </label>
            <div className="relative">
              <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                {CURRENCY_SYMBOL}
              </span>
              <input
                id="credit_limit"
                name="credit_limit"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
                className={`numeric ${field} pl-7`}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              Zero means they pay at the counter. Only an owner can set this.
            </p>
          </div>
          <div>
            <label htmlFor="payment_terms_days" className="micro mb-2 block">
              Payment terms
            </label>
            <div className="flex items-center gap-2">
              <input
                id="payment_terms_days"
                name="payment_terms_days"
                type="number"
                min="0"
                defaultValue="0"
                className={`numeric ${field}`}
              />
              <span className="shrink-0 text-sm text-ink-3">days</span>
            </div>
          </div>
        </div>

        <FormError message={state.error} />

        <div className="mt-5">
          <Submit />
        </div>
      </form>
    </div>
  );
}
