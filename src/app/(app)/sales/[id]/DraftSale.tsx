"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SalesOrderLineRow, SalesOrderRow, StockLevelRow } from "@/lib/data/types";
import { CURRENCY_SYMBOL, money, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { postSale, removeSaleLine, setSaleLine, type ActionState } from "../actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function DraftSale({
  sale,
  lines,
  available,
}: {
  sale: SalesOrderRow;
  lines: SalesOrderLineRow[];
  available: StockLevelRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [payingNow, setPayingNow] = useState(true);

  const [addState, addAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await setSaleLine(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { error: null });

  const [postState, postAction] = useActionState<ActionState, FormData>(postSale, { error: null });

  const onSale = new Set(lines.map((line) => line.product_id));
  const pickable = available.filter((row) => !onSale.has(row.product_id));

  // Only for the operator's benefit while building the sale; the authoritative
  // total is computed in SQL when it posts.
  const runningTotal = lines.reduce((sum, line) => sum + Number(line.line_total), 0);

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            What they are buying
          </h2>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nothing on this sale yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{line.product_name}</p>
                  <p className="code truncate">
                    {formatQty(line.qty)} {line.base_unit} × {money(line.unit_price)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="numeric text-sm text-ink">{money(line.line_total)}</span>
                  <form action={removeSaleLine}>
                    <input type="hidden" name="order_id" value={sale.id} />
                    <input type="hidden" name="product_id" value={line.product_id} />
                    <Button type="submit" variant="quiet" size="sm" aria-label={`Remove ${line.product_name}`}>
                      <Trash2 size={15} aria-hidden />
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form ref={formRef} action={addAction} className="border-t-2 border-line p-4">
          <input type="hidden" name="order_id" value={sale.id} />

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="product" className="micro mb-2 block">
                Product
              </label>
              <select id="product" name="product_id" required className={field}>
                <option value="">Choose…</option>
                {pickable.map((row) => (
                  <option key={row.product_id} value={row.product_id}>
                    {row.product_name} — {formatQty(row.qty_on_hand)} {row.base_unit}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qty" className="micro mb-2 block">
                Quantity
              </label>
              <input id="qty" name="qty" type="number" min="0.001" step="any" required className={`numeric ${field}`} />
            </div>

            <div>
              <label htmlFor="unit_price" className="micro mb-2 block">
                Price
              </label>
              <div className="relative">
                <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                  {CURRENCY_SYMBOL}
                </span>
                <input
                  id="unit_price"
                  name="unit_price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="list"
                  className={`numeric ${field} pl-7`}
                />
              </div>
            </div>
          </div>

          <FormError message={addState.error} />

          <div className="mt-4">
            <Submit label="Add" busy="Adding…" />
          </div>

          {pickable.length === 0 && lines.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">There is no stock at this location to sell.</p>
          ) : null}
        </form>
      </section>

      {lines.length > 0 ? (
        <form action={postAction} className="mt-5">
          <input type="hidden" name="order_id" value={sale.id} />

          <div className="rule bg-panel p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Take payment
              </h2>
              <span className="numeric text-lg text-ink">{money(runningTotal)}</span>
            </div>

            <div className="mt-4 flex gap-2">
              <label
                className={`press flex-1 cursor-pointer border-2 border-line px-3 py-2.5 text-center font-display text-xs font-bold uppercase tracking-wider ${
                  payingNow ? "bg-ink text-ink-invert" : "bg-panel text-ink"
                }`}
              >
                <input
                  type="radio"
                  checked={payingNow}
                  onChange={() => setPayingNow(true)}
                  className="sr-only"
                />
                Paying now
              </label>
              <label
                className={`press flex-1 cursor-pointer border-2 border-line px-3 py-2.5 text-center font-display text-xs font-bold uppercase tracking-wider ${
                  !payingNow ? "bg-ink text-ink-invert" : "bg-panel text-ink"
                } ${sale.customer_id ? "" : "pointer-events-none opacity-50"}`}
              >
                <input
                  type="radio"
                  checked={!payingNow}
                  onChange={() => setPayingNow(false)}
                  disabled={!sale.customer_id}
                  className="sr-only"
                />
                On credit
              </label>
            </div>

            {payingNow ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="paid_now" className="micro mb-2 block">
                    Amount received
                  </label>
                  <div className="relative">
                    <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                      {CURRENCY_SYMBOL}
                    </span>
                    <input
                      id="paid_now"
                      name="paid_now"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={runningTotal.toFixed(2)}
                      className={`numeric ${field} pl-7`}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="pay_method" className="micro mb-2 block">
                    How
                  </label>
                  <select id="pay_method" name="pay_method" defaultValue="cash" className={field}>
                    <option value="cash">Cash</option>
                    <option value="momo">Mobile money</option>
                    <option value="bank">Bank</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>
            ) : (
              <>
                <input type="hidden" name="paid_now" value="0" />
                <p className="mt-4 text-sm text-ink-3">
                  The full amount goes on {sale.customer_name}&rsquo;s account. It will be refused if
                  it takes them past their credit limit.
                </p>
              </>
            )}

            <p className="mt-4 text-sm text-ink-3">
              Posting takes the stock out at what it actually cost. It cannot be edited afterwards.
            </p>

            <FormError message={postState.error} />

            <div className="mt-4">
              <Submit label="Complete sale" busy="Posting…" />
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}
