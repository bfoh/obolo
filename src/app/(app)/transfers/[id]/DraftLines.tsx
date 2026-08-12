"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { StockLevelRow, TransferLineRow } from "@/lib/data/types";
import { qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import {
  dispatchTransfer,
  removeTransferLine,
  setTransferLine,
  type ActionState,
} from "../actions";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function DraftLines({
  transferId,
  lines,
  available,
  canDispatch,
}: {
  transferId: string;
  lines: TransferLineRow[];
  available: StockLevelRow[];
  canDispatch: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [addState, addAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await setTransferLine(prev, formData);
      if (!result.error) formRef.current?.reset();
      return result;
    },
    { error: null },
  );
  const [dispatchState, dispatchAction] = useActionState<ActionState, FormData>(dispatchTransfer, {
    error: null,
  });

  const onList = new Set(lines.map((line) => line.product_id));
  const pickable = available.filter((row) => !onList.has(row.product_id));

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Picking list
          </h2>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            Nothing on this list yet. Add the first product below.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{line.product_name}</p>
                  <p className="code truncate">{line.sku}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="numeric text-sm text-ink">
                    {formatQty(line.qty_dispatched)} {line.base_unit}
                  </span>
                  <form action={removeTransferLine}>
                    <input type="hidden" name="transfer_id" value={transferId} />
                    <input type="hidden" name="product_id" value={line.product_id} />
                    <Button
                      type="submit"
                      variant="quiet"
                      size="sm"
                      aria-label={`Remove ${line.product_name}`}
                    >
                      <Trash2 size={15} aria-hidden />
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form ref={formRef} action={addAction} className="border-t-2 border-line p-4">
          <input type="hidden" name="transfer_id" value={transferId} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="product" className="micro mb-2 block">
                Product
              </label>
              <select
                id="product"
                name="product_id"
                required
                className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
              >
                <option value="">Choose a product…</option>
                {pickable.map((row) => (
                  <option key={row.product_id} value={row.product_id}>
                    {row.product_name} — {formatQty(row.qty_on_hand)} {row.base_unit} on hand
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:w-32">
              <label htmlFor="qty" className="micro mb-2 block">
                Quantity
              </label>
              <input
                id="qty"
                name="qty"
                type="number"
                min="0.001"
                step="any"
                required
                className="numeric w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
              />
            </div>

            <Submit label="Add" busy="Adding…" />
          </div>

          <FormError message={addState.error} />

          {pickable.length === 0 && lines.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">
              There is no stock at this location to send.
            </p>
          ) : null}
        </form>
      </section>

      {canDispatch && lines.length > 0 ? (
        <form action={dispatchAction} className="mt-5">
          <input type="hidden" name="transfer_id" value={transferId} />
          <div className="rule bg-panel p-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
              Send it
            </h2>
            <p className="mt-1 text-sm text-ink-3">
              Dispatching moves this stock out of the warehouse and into transit. It stays counted
              and valued there until someone confirms what arrived.
            </p>
            <FormError message={dispatchState.error} />
            <div className="mt-4">
              <Submit label="Dispatch" busy="Dispatching…" />
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}
