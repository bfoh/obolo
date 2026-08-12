"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ProductRow, ReceiptLineRow, ReceiptRow } from "@/lib/data/types";
import { CURRENCY_SYMBOL, formatDate, isMasked, money, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { postReceipt, removeReceiptLine, setReceiptLine, type ActionState } from "../actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit({ label, busy, ...rest }: { label: string; busy: string } & { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...rest}>
      {pending ? busy : label}
    </Button>
  );
}

export function DraftReceipt({
  receipt,
  lines,
  products,
}: {
  receipt: ReceiptRow;
  lines: ReceiptLineRow[];
  products: ProductRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const [addState, addAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await setReceiptLine(prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, { error: null });

  const [postState, postAction] = useActionState<ActionState, FormData>(postReceipt, {
    error: null,
  });

  // Totals come from v_receipts, summed in SQL. Multiplying and adding these
  // in the browser would turn exact decimals into float64 and print a landed
  // total that disagrees with what posting will actually record.

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            What arrived
          </h2>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            Nothing on this delivery yet. Add the first line below.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{line.product_name}</p>
                  <p className="code truncate">
                    {line.sku}
                    {line.lot_code ? ` · ${line.lot_code}` : ""}
                    {line.expiry_date ? ` · exp ${formatDate(line.expiry_date)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-start gap-3">
                  <div className="text-right">
                    <p className="numeric text-sm text-ink">{formatQty(line.qty_received)}</p>
                    {isMasked(line.invoice_unit_cost) ? null : (
                      <p className="code">{money(line.invoice_unit_cost)} each</p>
                    )}
                  </div>
                  <form action={removeReceiptLine}>
                    <input type="hidden" name="receipt_id" value={receipt.id} />
                    <input type="hidden" name="product_id" value={line.product_id} />
                    <input type="hidden" name="lot_code" value={line.lot_code ?? ""} />
                    <input type="hidden" name="expiry_date" value={line.expiry_date ?? ""} />
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
          <input type="hidden" name="receipt_id" value={receipt.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="product" className="micro mb-2 block">
                Product
              </label>
              <select id="product" name="product_id" required className={field}>
                <option value="">Choose a product…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
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
                className={`numeric ${field}`}
              />
            </div>

            <div>
              <label htmlFor="cost" className="micro mb-2 block">
                Cost each
              </label>
              <div className="relative">
                <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                  {CURRENCY_SYMBOL}
                </span>
                <input
                  id="cost"
                  name="invoice_unit_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className={`numeric ${field} pl-7`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="lot" className="micro mb-2 block">
                Lot <span className="normal-case tracking-normal text-ink-3">(optional)</span>
              </label>
              <input id="lot" name="lot_code" type="text" className={`numeric ${field}`} />
            </div>

            <div>
              <label htmlFor="expiry" className="micro mb-2 block">
                Expiry <span className="normal-case tracking-normal text-ink-3">(optional)</span>
              </label>
              <input id="expiry" name="expiry_date" type="date" className={`numeric ${field}`} />
            </div>
          </div>

          <FormError message={addState.error} />

          <div className="mt-4">
            <Submit label="Add line" busy="Adding…" />
          </div>

          {products.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">
              There are no products yet. Add one in settings before recording a delivery.
            </p>
          ) : null}
        </form>
      </section>

      {lines.length > 0 ? (
        <form action={postAction} className="mt-5">
          <input type="hidden" name="receipt_id" value={receipt.id} />
          <div className="rule bg-panel p-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
              Bring it into stock
            </h2>

            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <dt className="micro">Goods</dt>
                <dd className="numeric mt-1 text-sm text-ink">{money(receipt.goods_total)}</dd>
              </div>
              <div>
                <dt className="micro">Charges</dt>
                <dd className="numeric mt-1 text-sm text-ink">{money(receipt.charges_total)}</dd>
              </div>
              <div>
                <dt className="micro">Total landed</dt>
                <dd className="numeric mt-1 text-sm font-medium text-ink">
                  {money(receipt.landed_total)}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-sm text-ink-3">
              Posting creates a costed batch for each line and adds the stock. It cannot be edited
              afterwards — a mistake is corrected by reversing it.
            </p>

            <FormError message={postState.error} />

            <div className="mt-4">
              <Submit label="Post delivery" busy="Posting…" />
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}
