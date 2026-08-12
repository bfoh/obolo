"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ProductRow } from "@/lib/data/types";
import { CURRENCY_SYMBOL } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { createProduct, updateProduct, type ActionState } from "@/app/(app)/products/actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Money({ id, label, defaultValue }: { id: string; label: string; defaultValue?: string }) {
  return (
    <div>
      <label htmlFor={id} className="micro mb-2 block">
        {label}
      </label>
      <div className="relative">
        <span className="numeric pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
          {CURRENCY_SYMBOL}
        </span>
        <input
          id={id}
          name={id}
          type="number"
          min="0"
          step="0.01"
          defaultValue={defaultValue}
          className={`numeric ${field} pl-7`}
        />
      </div>
    </div>
  );
}

/**
 * Create and edit share one form. The SKU is only offered on create: it is the
 * identifier printed on shelf labels and used to find the product, and quietly
 * changing it would break the link to everything already labelled.
 *
 * Cost is deliberately absent. It belongs to the batch, is set by the delivery
 * that brought the goods in, and is derived onto the product by post_receipt.
 * Typing a cost here would rewrite a valuation the ledger already recorded.
 */
export function ProductForm({
  product,
  onDone,
}: {
  product?: ProductRow;
  onDone?: () => void;
}) {
  const editing = Boolean(product);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = editing ? await updateProduct(prev, formData) : await createProduct(prev, formData);
      if (result.ok) onDone?.();
      return result;
    },
    { error: null },
  );

  return (
    <form action={formAction}>
      {product ? <input type="hidden" name="product_id" value={product.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {editing ? null : (
          <div>
            <label htmlFor="sku" className="micro mb-2 block">
              SKU
            </label>
            <input
              id="sku"
              name="sku"
              type="text"
              required
              placeholder="RICE-25"
              className={`numeric ${field}`}
            />
          </div>
        )}

        <div className={editing ? "sm:col-span-2" : ""}>
          <label htmlFor="name" className="micro mb-2 block">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={product?.name}
            placeholder="Rice 25kg bag"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="base_unit" className="micro mb-2 block">
            Unit
          </label>
          <input
            id="base_unit"
            name="base_unit"
            type="text"
            defaultValue={product?.base_unit ?? "piece"}
            placeholder="bag"
            className={field}
          />
        </div>

        <Money id="wholesale_price" label="Wholesale price" defaultValue={product?.wholesale_price ?? undefined} />
        <Money id="retail_price" label="Retail price" defaultValue={product?.retail_price ?? undefined} />

        <div>
          <label htmlFor="reorder_point" className="micro mb-2 block">
            Warn below
          </label>
          <input
            id="reorder_point"
            name="reorder_point"
            type="number"
            min="0"
            step="any"
            defaultValue={product?.reorder_point ?? undefined}
            className={`numeric ${field}`}
          />
        </div>

        <div>
          <label htmlFor="reorder_qty" className="micro mb-2 block">
            Reorder quantity
          </label>
          <input
            id="reorder_qty"
            name="reorder_qty"
            type="number"
            min="0"
            step="any"
            defaultValue={product?.reorder_qty ?? undefined}
            className={`numeric ${field}`}
          />
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          name="track_expiry"
          defaultChecked={product?.track_expiry}
          className="h-4 w-4 border-2 border-line accent-[var(--ink)]"
        />
        Track expiry dates on deliveries
      </label>

      <FormError message={state.error} />

      <div className="mt-5">
        <Submit label={editing ? "Save changes" : "Add product"} />
      </div>
    </form>
  );
}
