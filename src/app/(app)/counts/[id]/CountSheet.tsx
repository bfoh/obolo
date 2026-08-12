"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StockCountLineRow } from "@/lib/data/types";
import { plural, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { setCountLine, submitCount, type ActionState } from "../actions";

function SaveLine() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-label="Save count">
      <Check size={15} aria-hidden />
    </Button>
  );
}

function SubmitAll({ remaining }: { remaining: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Submitting…" : remaining > 0 ? `Submit with ${remaining} uncounted` : "Submit count"}
    </Button>
  );
}

/**
 * The count sheet.
 *
 * The system quantity is deliberately NOT shown while counting. If it were, the
 * number on the screen becomes the number people write down, and the count
 * stops being independent evidence of anything. Variances are revealed at
 * review, once the counting is finished.
 */
export function CountSheet({
  countId,
  lines,
}: {
  countId: string;
  lines: StockCountLineRow[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(setCountLine, { error: null });
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitCount, {
    error: null,
  });

  const remaining = lines.filter((line) => line.counted_qty === null).length;

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Count sheet
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            Write down what you actually find. What the system expects is hidden until review, so
            the count stays independent.
          </p>
        </div>

        <FormError message={state.error} />

        <ul className="divide-y divide-hairline">
          {lines.map((line) => (
            <li key={line.id} className="px-4 py-3">
              <form action={formAction} className="flex items-center justify-between gap-3">
                <input type="hidden" name="count_id" value={countId} />
                <input type="hidden" name="product_id" value={line.product_id} />

                <div className="min-w-0">
                  <label htmlFor={`count-${line.id}`} className="block truncate text-sm text-ink">
                    {line.product_name}
                  </label>
                  <p className="code truncate">
                    {line.sku}
                    {line.counted_qty !== null
                      ? ` · counted ${formatQty(line.counted_qty)} ${line.base_unit}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <input
                    id={`count-${line.id}`}
                    name="counted"
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={line.counted_qty ?? ""}
                    placeholder="—"
                    className="numeric w-24 border-2 border-line bg-panel-2 px-3 py-2.5 text-right text-ink outline-none focus-visible:border-focus"
                  />
                  <SaveLine />
                </div>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <form action={submitAction} className="mt-5">
        <input type="hidden" name="count_id" value={countId} />
        <div className="rule bg-panel p-4">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Finished counting
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {remaining > 0
              ? `${plural(remaining, "product")} not counted. They will be treated as matching the system.`
              : "Everything has been counted. The owner reviews the variances and decides what to accept."}
          </p>
          <FormError message={submitState.error} />
          <div className="mt-4">
            <SubmitAll remaining={remaining} />
          </div>
        </div>
      </form>
    </>
  );
}
