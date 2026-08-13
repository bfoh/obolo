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
  className,
}: {
  label: string;
  code: string;
  value: Numeric;
  units: Numeric;
  skus: number;
  tone?: Tone;
  className?: string;
}) {
  const masked = isMasked(value);

  return (
    // Two densities, one component. The desktop card is 184px tall, which is
    // fine in a three-column grid and absurd stacked in a phone column -- three
    // of them plus the hero ran 211px past the bottom of an iPhone. Below `sm`
    // the padding tightens, the figure drops a step, and the units/products
    // pair collapses from a bordered definition list to one line of text.
    <div className={cn("flex flex-col border-2 bg-panel p-4 sm:p-5", TONE[tone], className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">{label}</h2>
        <span className="code">{code}</span>
      </div>

      {masked ? (
        <p className="numeric mt-2 text-3xl font-semibold text-ink sm:mt-4 sm:text-4xl">
          {qty(units)}
        </p>
      ) : (
        <p className="numeric mt-2 text-3xl font-semibold tracking-tight text-ink sm:mt-4 sm:text-4xl">
          {money(value)}
        </p>
      )}

      {/* One line on a phone, the full pair from `sm` up. Same facts either
          way -- a phone just cannot afford 35px of labelled columns per tile. */}
      <p className="mt-1.5 text-xs text-ink-3 sm:hidden">
        <span className="numeric">{qty(units)}</span> units ·{" "}
        <span className="numeric">{skus}</span> products
      </p>

      <dl className="mt-4 hidden gap-6 border-t border-hairline pt-3 sm:flex">
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
