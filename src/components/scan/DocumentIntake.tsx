"use client";

import { AlertTriangle, Camera, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductRow } from "@/lib/data/types";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { postExtraction } from "@/app/(app)/receive/vision-actions";
import { CURRENCY_SYMBOL } from "@/lib/format";

const field =
  "w-full border-2 border-line bg-panel-2 px-2 py-2 text-sm text-ink outline-none focus-visible:border-focus";

interface ExtractedLine {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  confident: boolean;
}

interface Extraction {
  id: string;
  supplier: string | null;
  document_number: string | null;
  lines: ExtractedLine[];
  notes: string | null;
}

/**
 * Photograph a delivery note, then check it line by line.
 *
 * Nothing read off a photograph reaches the ledger on its own. Every line has
 * to be matched to a real product and its cost confirmed by the person holding
 * the paper, and lines the model was unsure of start switched off — a misread
 * digit here becomes a wrong stock valuation, so the default is to leave it out
 * rather than let it through.
 */
export function DocumentIntake({ products }: { products: ProductRow[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Extraction | null>(null);
  const [rows, setRows] = useState<
    { include: boolean; productId: string; qty: string; cost: string; description: string }[]
  >([]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("image", file);
      body.set("doc_type", "delivery_note");

      const response = await fetch("/api/vision", { method: "POST", body });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not read that photo.");
        return;
      }

      setDoc(data as Extraction);
      setRows(
        (data.lines as ExtractedLine[]).map((line) => ({
          // A line the model was unsure about starts unticked. Including it is
          // a deliberate act, not the default.
          include: line.confident && line.quantity !== null,
          productId: guessProduct(line.description, products),
          qty: line.quantity?.toString() ?? "",
          cost: line.unit_cost?.toString() ?? "",
          description: line.description,
        })),
      );
    } catch {
      setError("Could not upload that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!doc) return;
    setBusy(true);
    setError(null);

    const confirmed = rows
      .filter((row) => row.include && row.productId && Number(row.qty) > 0 && row.cost !== "")
      .map((row) => ({
        product_id: row.productId,
        qty: Number(row.qty),
        unit_cost: Number(row.cost),
      }));

    if (confirmed.length === 0) {
      setError("Match at least one line to a product, with a quantity and a cost.");
      setBusy(false);
      return;
    }

    const result = await postExtraction(doc.id, confirmed, doc.document_number ?? null);
    setBusy(false);

    if (result.error) setError(result.error);
    else if (result.receiptId) router.push(`/receive/${result.receiptId}`);
  }

  if (!doc) {
    return (
      <div className="rule bg-panel p-4">
        <div className="flex items-center gap-2">
          <Camera size={15} className="text-ink-3" aria-hidden />
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Photograph a delivery note
          </h2>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Snap the waybill and it will read the lines off it. You check every one before anything is
          brought into stock.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
          }}
        />

        <FormError message={error} />

        <div className="mt-4">
          <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Reading it…" : "Take a photo"}
          </Button>
        </div>
      </div>
    );
  }

  const unsure = doc.lines.filter((line) => !line.confident).length;

  return (
    <div className="rule bg-panel">
      <div className="flex items-start justify-between gap-3 border-b-2 border-line px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Check what it read
          </h2>
          <p className="code mt-0.5">
            {doc.supplier ?? "No supplier printed"}
            {doc.document_number ? ` · ${doc.document_number}` : ""}
          </p>
        </div>
        <Button type="button" variant="quiet" size="sm" onClick={() => setDoc(null)} aria-label="Start over">
          <X size={16} aria-hidden />
        </Button>
      </div>

      {unsure > 0 ? (
        <p className="flex items-start gap-2 border-b-2 border-line bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {unsure === 1 ? "One line was" : `${unsure} lines were`} unclear on the photo and
            {unsure === 1 ? " is" : " are"} switched off. Check the paper before including
            {unsure === 1 ? " it" : " them"}.
          </span>
        </p>
      ) : null}

      {doc.notes ? (
        <p className="border-b-2 border-line px-4 py-3 text-sm text-ink-3">{doc.notes}</p>
      ) : null}

      <ul className="divide-y divide-hairline">
        {rows.map((row, index) => (
          <li key={index} className="px-4 py-3">
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, include: event.target.checked } : r)),
                  )
                }
                className="h-4 w-4 border-2 border-line accent-[var(--ink)]"
              />
              <span className="truncate">{row.description}</span>
            </label>

            <div className="mt-2 grid gap-2 pl-7 sm:grid-cols-4">
              <select
                aria-label="Product"
                value={row.productId}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, productId: event.target.value } : r)),
                  )
                }
                className={`${field} sm:col-span-2`}
              >
                <option value="">Match to a product…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>

              <input
                aria-label="Quantity"
                type="number"
                step="any"
                min="0"
                value={row.qty}
                placeholder="qty"
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, qty: event.target.value } : r)),
                  )
                }
                className={`numeric ${field}`}
              />

              <input
                aria-label="Cost each"
                type="number"
                step="0.01"
                min="0"
                value={row.cost}
                placeholder={`${CURRENCY_SYMBOL} each`}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, cost: event.target.value } : r)),
                  )
                }
                className={`numeric ${field}`}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t-2 border-line p-4">
        <FormError message={error} />
        <div className="mt-1">
          <Button type="button" disabled={busy} onClick={post}>
            {busy ? "Building…" : "Build a delivery from these"}
          </Button>
        </div>
        <p className="mt-2 text-sm text-ink-3">
          This creates a draft delivery. Nothing is in stock until you post it.
        </p>
      </div>
    </div>
  );
}

/** Cheap first guess so the person is correcting rather than typing from scratch. */
function guessProduct(description: string, products: ProductRow[]): string {
  const words = description.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let best = "";
  let bestScore = 0;

  for (const product of products) {
    const name = product.name.toLowerCase();
    const score = words.filter((word) => name.includes(word)).length;
    if (score > bestScore) {
      bestScore = score;
      best = product.id;
    }
  }
  return bestScore > 0 ? best : "";
}
