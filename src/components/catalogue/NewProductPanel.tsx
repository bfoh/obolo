"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ProductForm } from "./ProductForm";

/**
 * Adding a product is the first thing anyone does in a new database, so the
 * form opens inline on the list rather than behind another navigation step.
 */
export function NewProductPanel({ openByDefault = false }: { openByDefault?: boolean }) {
  const [open, setOpen] = useState(openByDefault);

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        New product
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          New product
        </h2>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <X size={16} aria-hidden />
        </Button>
      </div>
      <ProductForm onDone={() => setOpen(false)} />
    </div>
  );
}
