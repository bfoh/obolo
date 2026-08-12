"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ProductRow, ReturnLineRow, ReturnRow } from "@/lib/data/types";
import { CURRENCY_SYMBOL, money, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { postReturn, setReturnLine, type ActionState } from "../actions";

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

export function DraftReturn({
  returnId,
  row,
  lines,
  products,
}: {
  returnId: string;
  row: ReturnRow;
  lines: ReturnLineRow[];
  products: ProductRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [addState, addAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await setReturnLine(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, { error: null });

  const [postState, postAction] = useActionState<ActionState, FormData>(postReturn, { error: null });

  const damaged = lines.filter((line) => line.condition === "damaged").length;

  return (
    <>
      <section className="rule bg-panel">
        <div className="flex items-center justify-between gap-3 border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            What came back
          </h2>
          <span className="numeric text-sm text-ink">{money(row.credit_total)}</span>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nothing on this return yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{line.product_name}</p>
                  <p className="code truncate">
                    {formatQty(line.qty)} {line.base_unit} ·{" "}
                    {line.condition === "damaged" ? "damaged" : "resalable"}
                  </p>
                </div>
                <span className="numeric shrink-0 text-sm text-ink">{money(line.line_total)}</span>
              </li>
            ))}
          </ul>
        )}

        <form ref={formRef} action={addAction} className="border-t-2 border-line p-4">
          <input type="hidden" name="return_id" value={returnId} />

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="rl_product" className="micro mb-2 block">
                Product
              </label>
              <select id="rl_product" name="product_id" required className={field}>
                <option value="">Choose…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rl_qty" className="micro mb-2 block">
                How many
              </label>
              <input id="rl_qty" name="qty" type="number" min="0.001" step="any" required className={`numeric ${field}`} />
            </div>

            <div>
              <label htmlFor="rl_condition" className="micro mb-2 block">
                Condition
              </label>
              <select id="rl_condition" name="condition" defaultValue="resalable" className={field}>
                <option value="resalable">Resalable</option>
                <option value="damaged">Damaged</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="rl_price" className="micro mb-2 block">
                Credit each{" "}
                <span className="normal-case tracking-normal text-ink-3">(blank uses what they paid)</span>
              </label>
              <div className="relative">
                <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
                  {CURRENCY_SYMBOL}
                </span>
                <input
                  id="rl_price"
                  name="unit_price"
                  type="number"
                  min="0"
                  step="0.01"
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
      </section>

      {lines.length > 0 ? (
        <form action={postAction} className="mt-5">
          <input type="hidden" name="return_id" value={returnId} />
          <div className="rule bg-panel p-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
              Accept the return
            </h2>
            <p className="mt-1 text-sm text-ink-3">
              Resalable goods go back to the batch they came from, at the cost they left at.
              {damaged > 0
                ? ` The ${damaged === 1 ? "damaged line does" : "damaged lines do"} not re-enter stock — they are credited but written off.`
                : ""}
            </p>
            <FormError message={postState.error} />
            <div className="mt-4">
              <Submit label="Post return" busy="Posting…" />
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}
