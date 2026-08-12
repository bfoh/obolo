import { Undo2 } from "lucide-react";
import { formatDateTime, isMasked, money, qty as formatQty } from "@/lib/format";
import { movementLabel, movementTone } from "@/lib/movements";
import type { StockMovementRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const TONE_TEXT = {
  in: "text-tally",
  out: "text-ink-2",
  loss: "text-signal",
} as const;

export function MovementList({
  movements,
  showLocation = false,
}: {
  movements: StockMovementRow[];
  showLocation?: boolean;
}) {
  if (movements.length === 0) {
    return (
      <div className="rule bg-panel px-5 py-8 text-center">
        <p className="text-sm text-ink-3">Nothing has moved yet.</p>
      </div>
    );
  }

  return (
    <div className="rule bg-panel">
      <div className="border-b-2 border-line px-4 py-3">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          Movement history
        </h3>
      </div>

      <ul>
        {movements.map((movement) => {
          const tone = movementTone(movement.type);
          const qtyValue = Number(movement.qty_delta);
          const isReversal = movement.reverses_movement_id !== null;

          return (
            <li
              key={movement.id}
              className={cn(
                "flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0",
                // A reversed movement is still part of the record; it is dimmed
                // rather than removed, because the ledger never deletes.
                movement.is_reversed && "opacity-55",
              )}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm text-ink">
                  {isReversal ? <Undo2 size={13} className="shrink-0 text-ink-3" aria-hidden /> : null}
                  <span className="truncate">
                    {isReversal ? `Reversed: ${movementLabel(movement.type)}` : movementLabel(movement.type)}
                  </span>
                </p>
                <p className="code truncate">
                  {formatDateTime(movement.occurred_at)}
                  {showLocation ? ` · ${movement.location_code}` : ""}
                  {movement.created_by_name ? ` · ${movement.created_by_name}` : ""}
                </p>
                {movement.reason ? (
                  <p className="mt-1 truncate text-xs text-ink-3">{movement.reason}</p>
                ) : null}
                {movement.is_reversed ? (
                  <p className="mt-1 font-display text-[10px] font-bold uppercase tracking-wider text-ink-3">
                    Reversed
                  </p>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <p className={cn("numeric text-sm font-medium", TONE_TEXT[tone])}>
                  {qtyValue > 0 ? "+" : ""}
                  {formatQty(movement.qty_delta)}
                </p>
                {isMasked(movement.value_delta) ? null : (
                  <p className="code">{money(movement.value_delta, { signed: qtyValue > 0 })}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
