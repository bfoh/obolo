"use client";

import { ScanLine, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { BarcodeScanner } from "./BarcodeScanner";
import { addBarcode, removeBarcode, type BarcodeActionState } from "@/app/(app)/scan/actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

interface Barcode {
  id: string;
  barcode: string;
  unit: string;
  is_primary: boolean;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Add code"}
    </Button>
  );
}

/**
 * The codes that identify a product.
 *
 * More than one is normal and is the point: a carton and a single sachet of the
 * same goods carry different barcodes, and scanning the carton must record a
 * carton. Each code therefore stores the packaging level it identifies.
 */
export function BarcodePanel({
  productId,
  baseUnit,
  packUnit,
  barcodes,
}: {
  productId: string;
  baseUnit: string;
  packUnit: string | null;
  barcodes: Barcode[];
}) {
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction] = useActionState<BarcodeActionState, FormData>(
    async (prev, formData) => {
      const result = await addBarcode(prev, formData);
      if (result.ok && inputRef.current) inputRef.current.value = "";
      return result;
    },
    { error: null },
  );

  const units = [baseUnit, packUnit].filter((u): u is string => Boolean(u));

  return (
    <section className="rule bg-panel">
      <div className="border-b-2 border-line px-4 py-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">Barcodes</h2>
        <p className="mt-1 text-sm text-ink-3">
          A carton and a single {baseUnit} carry different codes. Record which packaging each one
          identifies so a scan records the right quantity.
        </p>
      </div>

      {barcodes.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {barcodes.map((code) => (
            <li key={code.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="numeric truncate text-sm text-ink">{code.barcode}</p>
                <p className="code truncate">
                  per {code.unit}
                  {code.is_primary ? " · primary" : ""}
                </p>
              </div>
              <form action={removeBarcode}>
                <input type="hidden" name="product_id" value={productId} />
                <input type="hidden" name="barcode" value={code.barcode} />
                <Button type="submit" variant="quiet" size="sm" aria-label={`Remove ${code.barcode}`}>
                  <Trash2 size={15} aria-hidden />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="border-t-2 border-line p-4">
        <input type="hidden" name="product_id" value={productId} />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="barcode" className="micro mb-2 block">
              Barcode
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                id="barcode"
                name="barcode"
                type="text"
                inputMode="numeric"
                required
                className={`numeric ${field}`}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScanning(true)}
                aria-label="Scan a barcode"
              >
                <ScanLine size={15} aria-hidden />
              </Button>
            </div>
          </div>

          <div>
            <label htmlFor="unit" className="micro mb-2 block">
              Identifies a
            </label>
            <select id="unit" name="unit" className={field} defaultValue={baseUnit}>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="is_primary"
            className="h-4 w-4 border-2 border-line accent-[var(--ink)]"
          />
          This is the main code for the product
        </label>

        <FormError message={state.error} />

        <div className="mt-4">
          <Submit />
        </div>
      </form>

      {scanning ? (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onScan={(code) => {
            setScanning(false);
            if (inputRef.current) inputRef.current.value = code;
          }}
        />
      ) : null}
    </section>
  );
}
