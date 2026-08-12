"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { TransferLineRow } from "@/lib/data/types";
import { qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { receiveTransfer, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Confirming…" : "Confirm arrival"}
    </Button>
  );
}

export function ReceiveForm({
  transferId,
  lines,
}: {
  transferId: string;
  lines: TransferLineRow[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(receiveTransfer, {
    error: null,
  });

  const outstanding = lines.filter((line) => Number(line.qty_in_transit) > 0);

  if (outstanding.length === 0) {
    return (
      <div className="rule bg-panel p-4">
        <p className="text-sm text-ink-3">Everything on this transfer has been received.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rule bg-panel">
      <input type="hidden" name="transfer_id" value={transferId} />

      <div className="border-b-2 border-line px-4 py-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          What arrived
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          Count it and enter what is actually there. Anything short stays in transit for someone to
          explain — it is not written off quietly.
        </p>
      </div>

      <ul className="divide-y divide-hairline">
        {outstanding.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <label htmlFor={`qty__${line.id}`} className="block truncate text-sm text-ink">
                {line.product_name}
              </label>
              <p className="code truncate">
                {formatQty(line.qty_in_transit)} {line.base_unit} in transit
              </p>
            </div>
            <input
              id={`qty__${line.id}`}
              name={`qty__${line.id}`}
              type="number"
              min="0"
              max={line.qty_in_transit}
              step="any"
              // Pre-filled with the full amount, since everything arriving is
              // the normal case; a short delivery is an edit, not the default.
              defaultValue={line.qty_in_transit}
              className="numeric w-28 shrink-0 border-2 border-line bg-panel-2 px-3 py-2.5 text-right text-ink outline-none focus-visible:border-focus"
            />
          </li>
        ))}
      </ul>

      <div className="border-t-2 border-line p-4">
        <FormError message={state.error} />
        <div className="mt-1">
          <Submit />
        </div>
      </div>
    </form>
  );
}
