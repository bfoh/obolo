import { AlertTriangle } from "lucide-react";
import { bandOpacity, buildBatchColumn, type BatchInput } from "@/lib/batchColumn";
import { daysUntil, formatDate, isMasked, money, plural, qty as formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The Batch Column.
 *
 * A product's stock at one location, drawn as strata: one band per batch,
 * oldest at the bottom, height by quantity, darkening with age. FIFO order,
 * stock aging and cost layering in one glyph -- the app's central idea made
 * visible.
 *
 * Labels sit in a column beside the bands rather than inside them. Text on top
 * of a shade ramp has to fight for contrast at every step of the ramp, and the
 * ramp is doing real work here; moving the text out keeps both legible.
 */
export function BatchColumn({
  batches,
  unit,
  className,
}: {
  batches: BatchInput[];
  unit: string;
  className?: string;
}) {
  const column = buildBatchColumn(batches);

  if (column.bands.length === 0) {
    return (
      <div className={cn("rule bg-panel px-5 py-8 text-center", className)}>
        <p className="text-sm text-ink-3">No stock of this product here.</p>
      </div>
    );
  }

  return (
    <div className={cn("rule bg-panel p-4", className)}>
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
          Batches
        </h3>
        <span className="code">
          {plural(column.batchCount, "layer")} · {formatQty(column.totalQty)} {unit}
        </span>
      </div>

      {/* flex-col-reverse puts the oldest batch at the bottom, like strata. */}
      <div className="flex gap-3" style={{ height: `${Math.max(column.bands.length * 44, 180)}px` }}>
        <div
          className="flex w-12 shrink-0 flex-col-reverse overflow-hidden border-2 border-line"
          role="img"
          aria-label={`${plural(column.batchCount, "batch", "batches")}, oldest at the bottom, totalling ${formatQty(column.totalQty)} ${unit}`}
        >
          {column.bands.map((band) => (
            <div
              key={band.id}
              className="relative w-full border-t border-surface first:border-t-0"
              style={{ height: `${band.heightPercent}%` }}
            >
              <div className="absolute inset-0 bg-ink" style={{ opacity: bandOpacity(band.agePosition) }} />
              {band.isNext ? (
                <div className="absolute inset-y-0 left-0 w-1 bg-signal" aria-hidden />
              ) : null}
            </div>
          ))}
        </div>

        <ul className="flex flex-1 flex-col-reverse">
          {column.bands.map((band) => {
            const days = daysUntil(band.expiryDate);
            const expiringSoon = days !== null && days <= 30;

            return (
              <li
                key={band.id}
                className="flex min-h-0 items-center justify-between gap-3 border-t border-hairline first:border-t-0"
                style={{ height: `${band.heightPercent}%` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">
                    <span className="numeric font-medium">{formatQty(band.qty)}</span>{" "}
                    <span className="text-ink-3">{unit}</span>
                    {band.isNext ? (
                      // Leading space so a screen reader does not run this into
                      // the unit as "60 bagNext out".
                      <span className="ml-2 align-middle font-display text-[10px] font-bold uppercase tracking-widest text-signal">
                        {" "}
                        Next out
                      </span>
                    ) : null}
                  </p>
                  <p className="code truncate">
                    {band.lotCode ?? "no lot"} · in {formatDate(band.originReceivedAt)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {isMasked(band.unitCost) ? (
                    <p className="text-sm text-ink-3">—</p>
                  ) : (
                    <>
                      <p className="numeric text-sm text-ink">{money(band.remainingValue)}</p>
                      <p className="code">{money(band.unitCost)}/{unit}</p>
                    </>
                  )}
                  {expiringSoon ? (
                    <p
                      className={cn(
                        "mt-0.5 flex items-center justify-end gap-1 font-display text-[10px] font-bold uppercase tracking-wider",
                        days !== null && days < 0 ? "text-signal" : "text-warn",
                      )}
                    >
                      <AlertTriangle size={11} aria-hidden />
                      {days !== null && days < 0 ? "Expired" : `${days}d left`}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {column.heightsAdjusted ? (
        <p className="mt-3 border-t border-hairline pt-2 text-xs text-ink-3">
          Small layers are drawn taller than scale so they stay visible.
        </p>
      ) : null}
    </div>
  );
}
