"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow } from "@/lib/data/types";
import { createTransfer, type ActionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="mt-6 w-full">
      {pending ? "Starting…" : "Start transfer"}
    </Button>
  );
}

export function NewTransferForm({ locations }: { locations: LocationRow[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createTransfer, { error: null });

  const warehouse = locations.find((l) => l.kind === "warehouse");
  const shop = locations.find((l) => l.kind === "retail");

  return (
    <form action={formAction}>
      <p className="mb-5 text-sm text-ink-3">
        Start a picking list. Nothing leaves the warehouse until you dispatch it.
      </p>

      <label htmlFor="from" className="micro mb-2 block">
        From
      </label>
      <select
        id="from"
        name="from_location_id"
        defaultValue={warehouse?.id}
        required
        className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      <label htmlFor="to" className="micro mt-4 mb-2 block">
        To
      </label>
      <select
        id="to"
        name="to_location_id"
        defaultValue={shop?.id}
        required
        className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      <label htmlFor="notes" className="micro mt-4 mb-2 block">
        Note <span className="normal-case tracking-normal text-ink-3">(optional)</span>
      </label>
      <input
        id="notes"
        name="notes"
        type="text"
        placeholder="Driver, vehicle, anything worth recording"
        className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
      />

      <FormError message={state.error} />
      <Submit />
    </form>
  );
}
