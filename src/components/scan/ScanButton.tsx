"use client";

import { ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { BarcodeScanner } from "./BarcodeScanner";
import { lookupBarcode, type ScanResult } from "@/app/(app)/scan/actions";
import { money, qty as formatQty, isMasked } from "@/lib/format";

/**
 * Scan a code, see what it is and how much of it is here.
 *
 * The result stays on screen rather than navigating straight to the product,
 * because the usual reason to scan something on the floor is to answer "how
 * many of these do we have" — and being thrown onto another page loses your
 * place in the aisle.
 */
export function ScanButton({ locationId, label = "Scan" }: { locationId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onScan(code: string) {
    setOpen(false);
    startTransition(async () => {
      setResult(await lookupBarcode(code, locationId));
    });
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <ScanLine size={14} aria-hidden />
        {label}
      </Button>

      {open ? <BarcodeScanner onScan={onScan} onClose={() => setOpen(false)} /> : null}

      {pending ? <p className="mt-3 text-sm text-ink-3">Looking it up…</p> : null}

      {result && !pending ? (
        <div className="rule mt-3 w-full bg-panel p-4" role="status">
          {result.found ? (
            <>
              <p className="text-sm text-ink">{result.product_name}</p>
              <p className="code">
                {result.sku} · scanned as {result.unit}
              </p>
              <p className="numeric mt-3 text-2xl text-ink">
                {formatQty(result.qty_on_hand)}{" "}
                <span className="text-base text-ink-3">{result.base_unit} here</span>
              </p>
              {isMasked(result.stock_value) ? null : (
                <p className="code mt-1">worth {money(result.stock_value)}</p>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => router.push(`/stock/${result.product_id}?location=${locationId}`)}
                >
                  Open product
                </Button>
                <Button type="button" size="sm" variant="quiet" onClick={() => setResult(null)}>
                  Dismiss
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">Nothing is registered to that code.</p>
              <p className="code mt-1">{result.barcode}</p>
              <p className="mt-2 text-sm text-ink-3">
                Open the product and add this barcode to it, then it will be recognised next time.
              </p>
              <div className="mt-4">
                <Button type="button" size="sm" variant="quiet" onClick={() => setResult(null)}>
                  Dismiss
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
