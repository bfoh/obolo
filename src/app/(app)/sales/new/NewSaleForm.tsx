"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CustomerRow } from "@/lib/data/types";
import { createSale, type ActionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { money } from "@/lib/format";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="mt-6 w-full">
      {pending ? "Starting…" : "Start sale"}
    </Button>
  );
}

export function NewSaleForm({
  channels,
  customers,
}: {
  channels: ("wholesale" | "retail")[];
  customers: CustomerRow[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createSale, { error: null });
  const [channel, setChannel] = useState(channels[0] ?? "retail");
  const [customerId, setCustomerId] = useState("");

  const customer = customers.find((c) => c.id === customerId);
  // Wholesale must be to a named customer; only the till serves a stranger.
  const needsCustomer = channel === "wholesale";

  return (
    <form action={formAction}>
      <fieldset>
        <legend className="micro mb-2">Counter</legend>
        <div className="flex gap-2">
          {channels.map((option) => (
            <label
              key={option}
              className={`press flex-1 cursor-pointer border-2 border-line px-3 py-2.5 text-center font-display text-xs font-bold uppercase tracking-wider ${
                channel === option ? "bg-ink text-ink-invert" : "bg-panel text-ink"
              }`}
            >
              <input
                type="radio"
                name="channel"
                value={option}
                checked={channel === option}
                onChange={() => setChannel(option)}
                className="sr-only"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="customer" className="micro mt-4 mb-2 block">
        Customer {needsCustomer ? "" : <span className="normal-case tracking-normal text-ink-3">(optional)</span>}
      </label>
      <select
        id="customer"
        name="customer_id"
        required={needsCustomer}
        value={customerId}
        onChange={(event) => setCustomerId(event.target.value)}
        className={field}
      >
        <option value="">{needsCustomer ? "Choose a customer…" : "Walk-in"}</option>
        {customers.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      {customer ? (
        <p className="mt-2 text-sm text-ink-3">
          Owes <span className="numeric">{money(customer.balance)}</span> · credit left{" "}
          <span className="numeric">{money(customer.credit_available)}</span>
        </p>
      ) : null}

      <label htmlFor="due_date" className="micro mt-4 mb-2 block">
        Due date <span className="normal-case tracking-normal text-ink-3">(leave blank if paying now)</span>
      </label>
      <input
        id="due_date"
        name="due_date"
        type="date"
        disabled={!customerId}
        className={`numeric ${field} disabled:opacity-50`}
      />
      {!customerId ? (
        <p className="mt-1.5 text-xs text-ink-3">Credit needs a named customer.</p>
      ) : null}

      <label htmlFor="notes" className="micro mt-4 mb-2 block">
        Note <span className="normal-case tracking-normal text-ink-3">(optional)</span>
      </label>
      <input id="notes" name="notes" type="text" className={field} />

      <FormError message={state.error} />
      <Submit />
    </form>
  );
}
