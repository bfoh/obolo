"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow } from "@/lib/data/types";
import { startCount, type ActionState } from "./actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Freezing…" : "Start counting"}
    </Button>
  );
}

export function StartCountPanel({
  locations,
  openByDefault = false,
}: {
  locations: LocationRow[];
  openByDefault?: boolean;
}) {
  const [open, setOpen] = useState(openByDefault);
  const [state, formAction] = useActionState<ActionState, FormData>(startCount, { error: null });

  if (locations.length === 0) {
    return <span className="code">a count is already open</span>;
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        Start a count
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          Start a count
        </h2>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} aria-hidden />
        </Button>
      </div>

      <form action={formAction}>
        <p className="mb-4 text-sm text-ink-3">
          Starting a count freezes the location. Nothing can be received, sold or transferred there
          until it is posted or cancelled — otherwise the variances would just be movements that
          happened while you were counting.
        </p>

        <label htmlFor="location_id" className="micro mb-2 block">
          Where
        </label>
        <select id="location_id" name="location_id" required className={field}>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>

        <label htmlFor="notes" className="micro mt-4 mb-2 block">
          Note <span className="normal-case tracking-normal text-ink-3">(optional)</span>
        </label>
        <input id="notes" name="notes" type="text" className={field} />

        <FormError message={state.error} />

        <div className="mt-5">
          <Submit />
        </div>
      </form>
    </div>
  );
}
