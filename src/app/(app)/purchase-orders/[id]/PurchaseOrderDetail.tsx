"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ProductRow, PurchaseOrderLineRow, PurchaseOrderRow } from "@/lib/data/types";
import { CURRENCY_SYMBOL, isMasked, money, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { receiveAgainstPo, removePoLine, setPoLine, setPoStatus, type ActionState } from "../actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit({ label, busy, variant }: { label: string; busy: string; variant?: "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function PurchaseOrderDetail({
  po,
  lines,
  products,
  canEdit,
}: {
  po: PurchaseOrderRow;
  lines: PurchaseOrderLineRow[];
  products: ProductRow[];
  canEdit: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [addState, addAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await setPoLine(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { error: null });

  const [receiveState, receiveAction] = useActionState<ActionState, FormData>(receiveAgainstPo, {
    error: null,
  });

  const onOrder = new Set(lines.map((line) => line.product_id));
  const pickable = products.filter((product) => !onOrder.has(product.id));
  const canReceive =
    po.status === "sent" || po.status === "partially_received";

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            On order
          </h2>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nothing on this order yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lines.map((line) => {
              const outstanding = Number(line.qty_outstanding);
              return (
                <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{line.product_name}</p>
                    <p className="code truncate">
                      {formatQty(line.qty_received)} of {formatQty(line.qty_ordered)}{" "}
                      {line.base_unit} received
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-3">
                    <div className="text-right">
                      {isMasked(line.line_total) ? null : (
                        <p className="numeric text-sm text-ink">{money(line.line_total)}</p>
                      )}
                      {outstanding > 0 ? (
                        <p className="code text-warn">{formatQty(outstanding)} to come</p>
                      ) : (
                        <p className="code text-tally">complete</p>
                      )}
                    </div>
                    {canEdit && Number(line.qty_received) === 0 ? (
                      <form action={removePoLine}>
                        <input type="hidden" name="po_id" value={po.id} />
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
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canEdit ? (
          <form ref={formRef} action={addAction} className="border-t-2 border-line p-4">
            <input type="hidden" name="po_id" value={po.id} />

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label htmlFor="po_product" className="micro mb-2 block">
                  Product
                </label>
                <select id="po_product" name="product_id" required className={field}>
                  <option value="">Choose…</option>
                  {pickable.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="po_qty" className="micro mb-2 block">
                  How many
                </label>
                <input
                  id="po_qty"
                  name="qty"
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  className={`numeric ${field}`}
                />
              </div>

              <div>
                <label htmlFor="po_cost" className="micro mb-2 block">
                  Cost each
                </label>
                <div className="relative">
                  <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                    {CURRENCY_SYMBOL}
                  </span>
                  <input
                    id="po_cost"
                    name="unit_cost"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="last paid"
                    className={`numeric ${field} pl-7`}
                  />
                </div>
              </div>
            </div>

            <FormError message={addState.error} />

            <div className="mt-4">
              <Submit label="Add" busy="Adding…" />
            </div>
          </form>
        ) : null}
      </section>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {canEdit && po.status === "draft" && lines.length > 0 ? (
          <form action={setPoStatus}>
            <input type="hidden" name="po_id" value={po.id} />
            <input type="hidden" name="status" value="sent" />
            <div className="rule h-full bg-panel p-4">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Send it
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Marks the order as placed with {po.supplier_name}. You can receive against it once
                it is sent.
              </p>
              <div className="mt-4">
                <Submit label="Mark as sent" busy="Sending…" />
              </div>
            </div>
          </form>
        ) : null}

        {canReceive ? (
          <form action={receiveAction}>
            <input type="hidden" name="po_id" value={po.id} />
            <div className="rule h-full bg-panel p-4">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                It has arrived
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Opens a delivery pre-filled with what is still outstanding, priced as ordered. Adjust
                anything that came in short before posting.
              </p>
              <FormError message={receiveState.error} />
              <div className="mt-4">
                <Submit label="Receive against this order" busy="Opening…" />
              </div>
            </div>
          </form>
        ) : null}

        {canEdit && po.status !== "draft" ? (
          <form action={setPoStatus}>
            <input type="hidden" name="po_id" value={po.id} />
            <input type="hidden" name="status" value="closed" />
            <div className="rule h-full bg-panel p-4">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Close the order
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Stops expecting the rest. Anything already received stays exactly as it is.
              </p>
              <div className="mt-4">
                <Submit label="Close" busy="Closing…" variant="secondary" />
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </>
  );
}
