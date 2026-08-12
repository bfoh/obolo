"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StockCountLineRow, StockCountRow } from "@/lib/data/types";
import { isMasked, money, qty as formatQty } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { cancelCount, postCount, type ActionState } from "../actions";

function Post() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Posting…" : "Accept and post"}
    </Button>
  );
}

/**
 * What the owner sees before deciding.
 *
 * Posting turns a discrepancy into an accepted adjustment, which is why only an
 * owner can do it. If the person who counted could also post, a shortfall could
 * be counted away and nothing would record that it ever existed.
 */
export function VarianceReview({
  countId,
  count,
  lines,
  canPost,
}: {
  countId: string;
  count: StockCountRow;
  lines: StockCountLineRow[];
  canPost: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(postCount, { error: null });

  const variances = lines.filter((line) => Number(line.variance_qty) !== 0);
  const short = variances.filter((line) => Number(line.variance_qty) < 0);
  const over = variances.filter((line) => Number(line.variance_qty) > 0);

  return (
    <>
      <section className="rule bg-panel">
        <div className="border-b-2 border-line px-4 py-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            Variances
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            {variances.length === 0
              ? "Everything counted matched the system."
              : `${short.length} short, ${over.length} over.`}
          </p>
        </div>

        {variances.length > 0 ? (
          <ul className="divide-y divide-hairline">
            {variances.map((line) => {
              const delta = Number(line.variance_qty);
              return (
                <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{line.product_name}</p>
                    <p className="code truncate">
                      system {formatQty(line.system_qty)} · counted {formatQty(line.counted_qty)}
                    </p>
                    {line.note ? (
                      <p className="mt-1 truncate text-xs text-ink-3">{line.note}</p>
                    ) : null}
                  </div>
                  <span
                    className={`numeric shrink-0 text-sm font-medium ${
                      delta < 0 ? "text-signal" : "text-tally"
                    }`}
                  >
                    {delta > 0 ? "+" : ""}
                    {formatQty(line.variance_qty)} {line.base_unit}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {canPost ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <form action={formAction}>
            <input type="hidden" name="count_id" value={countId} />
            <div className="rule h-full bg-panel p-4">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Accept the count
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Shortfalls are written off at what those goods cost. Extra stock found is brought in
                at what the same goods on that shelf are worth. The location unfreezes.
              </p>
              <FormError message={state.error} />
              <div className="mt-4">
                <Post />
              </div>
            </div>
          </form>

          <form action={cancelCount}>
            <input type="hidden" name="count_id" value={countId} />
            <div className="rule h-full bg-panel p-4">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Throw it away
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Discards every variance and unfreezes the location. Nothing is recorded — use this
                only if the count itself was done wrong.
              </p>
              <div className="mt-4">
                <Button type="submit" variant="secondary">
                  Cancel count
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <p className="mt-5 border-2 border-line bg-panel px-4 py-3 text-sm text-ink-3">
          Submitted for review. An owner decides which variances to accept — the person who counted
          cannot post them.
          {isMasked(count.variance_value) ? "" : ` Worth ${money(count.variance_value)}.`}
        </p>
      )}
    </>
  );
}
