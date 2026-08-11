/**
 * Display formatting for money, quantities and identifiers.
 *
 * PostgREST returns Postgres `numeric` as a JSON **string** so that values
 * wider than a float64 survive the wire. Every function here therefore accepts
 * `string | number | null` and treats the string form as authoritative.
 *
 * Rule for this codebase: money arithmetic never happens in TypeScript. All
 * summing, allocation and valuation is done in SQL against `numeric`, and the
 * client only formats what it is given. A float64 cannot represent the
 * `numeric(18,6)` range exactly, so any client-side total would disagree with
 * the ledger — which is the one thing this app must never do.
 */

export const CURRENCY_SYMBOL = "₵"; // GHS cedi

/** A value that is either absent or a Postgres numeric on the wire. */
export type Numeric = string | number | null | undefined;

/**
 * Cost columns are masked to NULL for staff by the `public.v_*` views, which is
 * different from a genuine zero. Callers must render the two differently, so
 * masking is detected explicitly rather than being coerced to 0.
 */
export function isMasked(value: Numeric): value is null | undefined {
  return value === null || value === undefined;
}

function toNumber(value: Numeric): number | null {
  if (isMasked(value)) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface MoneyOptions {
  /** Render without the currency symbol (for table columns that head it once). */
  bare?: boolean;
  /** Placeholder when the value is masked or unparseable. */
  fallback?: string;
  /** Always show a leading + or −. Used for signed ledger deltas. */
  signed?: boolean;
}

/**
 * Formats a cedi amount at 2dp with grouped thousands.
 * Ledger values carry 6dp; display rounds, storage never does.
 */
export function money(value: Numeric, options: MoneyOptions = {}): string {
  const { bare = false, fallback = "—", signed = false } = options;
  const n = toNumber(value);
  if (n === null) return fallback;

  const abs = Math.abs(n).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const symbol = bare ? "" : CURRENCY_SYMBOL;
  if (n < 0) return `-${symbol}${abs}`;
  if (signed) return `+${symbol}${abs}`;
  return `${symbol}${abs}`;
}

/**
 * Formats a quantity. Quantities are `numeric(14,3)` because goods are sold in
 * kilos and litres as well as pieces, but whole numbers must not render as
 * "12.000" — a warehouse counts 12 cartons, not 12.000 cartons.
 */
export function qty(value: Numeric, fallback = "—"): string {
  const n = toNumber(value);
  if (n === null) return fallback;
  // Min 0 / max 3 trims trailing zeros in both directions: "12.000" renders as
  // "12" and "2.500" as "2.5", while "0.125" keeps its full precision.
  return n.toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** Quantity plus its unit, e.g. "12 cartons". Unit is not pluralised blindly. */
export function qtyWithUnit(value: Numeric, unit: string | null): string {
  const q = qty(value);
  if (!unit) return q;
  return `${q} ${unit}`;
}

/**
 * Compact form for dashboard tiles where a full figure would not fit.
 * Never used where an exact value is required.
 */
export function moneyCompact(value: Numeric, fallback = "—"): string {
  const n = toNumber(value);
  if (n === null) return fallback;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}${CURRENCY_SYMBOL}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${CURRENCY_SYMBOL}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  }
  return money(n);
}

/** Percentage from a already-computed ratio. Server supplies the ratio. */
export function percent(value: Numeric, fallback = "—"): string {
  const n = toNumber(value);
  if (n === null) return fallback;
  return `${(n * 100).toFixed(1)}%`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * Ghana is UTC+0 year-round with no DST, and the database runs in UTC, so
 * formatting in UTC is both correct and stable regardless of the viewer's
 * device timezone. Pinning it avoids a phone set to the wrong zone silently
 * shifting a movement onto the previous day.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return DATETIME_FMT.format(d);
}

/** Whole days from today until `value`. Negative when already past. */
export function daysUntil(value: string | Date | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / MS_PER_DAY);
}
