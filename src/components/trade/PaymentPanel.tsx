"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { recordPayment, type ActionState } from "@/app/(app)/sales/actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { CURRENCY_SYMBOL } from "@/lib/format";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Recording…" : "Record payment"}
    </Button>
  );
}

export function PaymentPanel({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await recordPayment(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { error: null });

  return (
    <form ref={formRef} action={formAction} className="rule bg-panel p-4">
      <input type="hidden" name="customer_id" value={customerId} />

      <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
        Take a payment
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        Settles {customerName}&rsquo;s oldest unpaid invoice first. Anything over sits on their
        account against the next one.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="amount" className="micro mb-2 block">
            Amount
          </label>
          <div className="relative">
            <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
              {CURRENCY_SYMBOL}
            </span>
            <input
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              className={`numeric ${field} pl-7`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="method" className="micro mb-2 block">
            How
          </label>
          <select id="method" name="method" defaultValue="cash" className={field}>
            <option value="cash">Cash</option>
            <option value="momo">Mobile money</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>

        <div>
          <label htmlFor="reference" className="micro mb-2 block">
            Reference
          </label>
          <input
            id="reference"
            name="reference"
            type="text"
            placeholder="MoMo or cheque no."
            className={`numeric ${field}`}
          />
        </div>
      </div>

      <FormError message={state.error} />

      <div className="mt-4">
        <Submit />
      </div>
    </form>
  );
}
