"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createSupplier, type ActionState } from "@/app/(app)/products/actions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Add supplier"}
    </Button>
  );
}

export function NewSupplierPanel({ openByDefault = false }: { openByDefault?: boolean }) {
  const [open, setOpen] = useState(openByDefault);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await createSupplier(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    { error: null },
  );

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />
        New supplier
      </Button>
    );
  }

  return (
    <div className="rule w-full bg-panel p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          New supplier
        </h2>
        <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} aria-hidden />
        </Button>
      </div>

      <form action={formAction}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="code" className="micro mb-2 block">
              Short code
            </label>
            <input id="code" name="code" type="text" required placeholder="ACCRA-1" className={`numeric ${field}`} />
          </div>
          <div>
            <label htmlFor="supplier_name" className="micro mb-2 block">
              Name
            </label>
            <input id="supplier_name" name="name" type="text" required className={field} />
          </div>
          <div>
            <label htmlFor="phone" className="micro mb-2 block">
              Phone
            </label>
            <input id="phone" name="phone" type="tel" className={`numeric ${field}`} />
          </div>
          <div>
            <label htmlFor="email" className="micro mb-2 block">
              Email
            </label>
            <input id="email" name="email" type="email" className={field} />
          </div>
        </div>

        <FormError message={state.error} />

        <div className="mt-5">
          <Submit />
        </div>
      </form>
    </div>
  );
}
