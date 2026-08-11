import { money, qty, isMasked, type Numeric } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "transit";

const TONE: Record<Tone, string> = {
  neutral: "border-line",
  // In-transit stock is neither here nor there, and a residual left in it is a
  // discrepancy rather than a balance. It is coloured so it reads as unsettled.
  transit: "border-transit",
};

/**
 * One location's stock position: what is on hand and what it is worth.
 *
 * `value` is null for staff -- the `public.v_*` views mask it rather than
 * sending a zero -- so the tile renders the quantity alone instead of implying
 * the stock is worthless.
 */
export function ValueTile({
  label,
  code,
  value,
  units,
  skus,
  tone = "neutral",
}: {
  label: string;
  code: string;
  value: Numeric;
  units: Numeric;
  skus: number;
  tone?: Tone;
}) {
  const masked = isMasked(value);

  return (
    <div className={cn("flex flex-col border-2 bg-panel p-5", TONE[tone])}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">{label}</h2>
        <span className="code">{code}</span>
      </div>

      {masked ? (
        <p className="numeric mt-4 text-4xl font-semibold text-ink">{qty(units)}</p>
      ) : (
        <p className="numeric mt-4 text-4xl font-semibold tracking-tight text-ink">{money(value)}</p>
      )}

      <dl className="mt-4 flex gap-6 border-t border-hairline pt-3">
        <div>
          <dt className="micro">Units</dt>
          <dd className="numeric mt-1 text-sm text-ink-2">{qty(units)}</dd>
        </div>
        <div>
          <dt className="micro">Products</dt>
          <dd className="numeric mt-1 text-sm text-ink-2">{skus}</dd>
        </div>
      </dl>
    </div>
  );
}
