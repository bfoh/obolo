import type { LedgerEntryRow } from "@/lib/data/types";
import { formatDateTime, money } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL: Record<LedgerEntryRow["entry_type"], string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit_note: "Credit note",
  adjustment: "Adjustment",
  write_off: "Written off",
};

/**
 * The customer's account, newest first.
 *
 * Every line is an entry that was appended; nothing here was ever edited or
 * removed, which is what lets the balance be re-derived from the page itself.
 * A reversal appears as its own line rather than making the original vanish.
 */
export function Statement({ entries }: { entries: LedgerEntryRow[] }) {
  if (entries.length === 0) {
    return (
      <div className="rule bg-panel px-5 py-8 text-center">
        <p className="text-sm text-ink-3">Nothing on this account yet.</p>
      </div>
    );
  }

  return (
    <section className="rule bg-panel">
      <div className="border-b-2 border-line px-4 py-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          Statement
        </h2>
      </div>

      <ul className="divide-y divide-hairline">
        {entries.map((entry) => {
          const amount = Number(entry.amount);
          // Positive increases what they owe; negative reduces it.
          const increasesDebt = amount > 0;

          return (
            <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{LABEL[entry.entry_type]}</p>
                <p className="code truncate">
                  {entry.invoice_no ?? entry.receipt_no ?? "—"} ·{" "}
                  {formatDateTime(entry.occurred_at)}
                  {entry.created_by_name ? ` · ${entry.created_by_name}` : ""}
                </p>
                {entry.reason ? (
                  <p className="mt-1 truncate text-xs text-ink-3">{entry.reason}</p>
                ) : null}
              </div>

              <span
                className={cn(
                  "numeric shrink-0 text-sm font-medium",
                  increasesDebt ? "text-ink" : "text-tally",
                )}
              >
                {money(entry.amount, { signed: increasesDebt })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
