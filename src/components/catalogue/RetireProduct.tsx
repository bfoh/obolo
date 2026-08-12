"use client";

import { setProductActive } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/Button";

/**
 * Products are retired, never deleted -- the ledger references them, and
 * deleting one would strand the history that priced it.
 */
export function RetireProduct({
  productId,
  isActive,
  hasStock,
}: {
  productId: string;
  isActive: boolean;
  hasStock: boolean;
}) {
  return (
    <form action={setProductActive} className="rule bg-panel p-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="active" value={isActive ? "false" : "true"} />

      <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
        {isActive ? "Retire this product" : "Bring this product back"}
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        {isActive
          ? "It stops appearing when recording deliveries and transfers. Its history stays exactly as it is."
          : "It will appear again when recording deliveries and transfers."}
      </p>

      {isActive && hasStock ? (
        <p className="mt-3 border-2 border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          There is still stock of this product. Move or write it off first.
        </p>
      ) : null}

      <div className="mt-4">
        <Button type="submit" variant={isActive ? "secondary" : "primary"} disabled={isActive && hasStock}>
          {isActive ? "Retire" : "Reactivate"}
        </Button>
      </div>
    </form>
  );
}
