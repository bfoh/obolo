/**
 * Geometry for the Batch Column.
 *
 * The Batch Column draws a product's position at one location as a stack of
 * strata -- one band per batch, oldest at the bottom, band height proportional
 * to quantity, shade darkening with age. It is the app's central idea made
 * visible: FIFO order, stock aging, and cost layering in a single glyph.
 *
 * The work here is laying out bands so the picture stays honest. A batch of 2
 * units next to one of 5,000 would round to nothing and disappear, which would
 * make the column lie about how many strata exist. Every band therefore gets a
 * floor, and the remaining height is shared out in proportion -- so heights
 * stay comparable while nothing vanishes.
 *
 * Quantities are treated as numbers here. That is safe and deliberate: they are
 * `numeric(14,3)` values used only to compute pixel heights, never money. Cost
 * stays a string all the way through and is only ever formatted.
 */

/** Smallest share of the column any single band may occupy. */
const MIN_BAND_FRACTION = 0.04;

export interface BatchInput {
  id: string;
  lot_code: string | null;
  /**
   * Quantities arrive from PostgREST as JSON numbers; the string form is
   * accepted too so the same code works against a direct SQL client, which
   * returns numeric as text.
   */
  qty_remaining: string | number;
  unit_cost: string | null;
  remaining_value: string | null;
  origin_received_at: string;
  expiry_date: string | null;
}

export interface BatchBand {
  id: string;
  lotCode: string | null;
  qty: number;
  unitCost: string | null;
  remainingValue: string | null;
  originReceivedAt: string;
  expiryDate: string | null;
  /** Share of total quantity. The honest number, for labels. */
  share: number;
  /** Share of the column's height, floored so small bands stay visible. */
  heightPercent: number;
  /** 0 for the oldest band, 1 for the newest. Drives the shade ramp. */
  agePosition: number;
  /** The band FIFO will draw from next. */
  isNext: boolean;
}

export interface BatchColumn {
  bands: BatchBand[];
  totalQty: number;
  batchCount: number;
  /** True when a band was floored, so heights are no longer strictly to scale. */
  heightsAdjusted: boolean;
}

function toNumber(value: string | number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param batches Batches at one location, already ordered oldest-first by
 *   `origin_received_at` -- the FIFO consumption order, which is what the
 *   column depicts. Order is not recomputed here.
 */
export function buildBatchColumn(batches: BatchInput[]): BatchColumn {
  const live = batches.filter((b) => toNumber(b.qty_remaining) > 0);

  if (live.length === 0) {
    return { bands: [], totalQty: 0, batchCount: 0, heightsAdjusted: false };
  }

  const quantities = live.map((b) => toNumber(b.qty_remaining));
  const totalQty = quantities.reduce((sum, q) => sum + q, 0);
  const count = live.length;

  // With enough bands the floor cannot be honoured for all of them; equal
  // heights are the least misleading fallback.
  const floorFits = count * MIN_BAND_FRACTION <= 1;
  const slack = floorFits ? 1 - count * MIN_BAND_FRACTION : 0;

  let adjusted = false;

  const bands = live.map((batch, index) => {
    const qty = quantities[index];
    const share = totalQty > 0 ? qty / totalQty : 0;

    let heightFraction: number;
    if (!floorFits) {
      heightFraction = 1 / count;
    } else {
      heightFraction = MIN_BAND_FRACTION + slack * share;
    }

    if (Math.abs(heightFraction - share) > 0.0001) adjusted = true;

    return {
      id: batch.id,
      lotCode: batch.lot_code,
      qty,
      unitCost: batch.unit_cost,
      remainingValue: batch.remaining_value,
      originReceivedAt: batch.origin_received_at,
      expiryDate: batch.expiry_date,
      share,
      heightPercent: heightFraction * 100,
      // A single band is neither old nor new relative to anything.
      agePosition: count === 1 ? 0 : index / (count - 1),
      isNext: index === 0,
    };
  });

  return { bands, totalQty, batchCount: count, heightsAdjusted: adjusted };
}

/**
 * Shade ramp for a band, oldest darkest.
 *
 * Returned as an alpha applied to a single ink, rather than a hue ramp: the
 * column encodes one variable (age), so it should vary along one axis. Hue is
 * reserved for status -- expiry and shortfall -- which must stay
 * distinguishable from mere age.
 */
export function bandOpacity(agePosition: number): number {
  const OLDEST = 1;
  const NEWEST = 0.32;
  return OLDEST - (OLDEST - NEWEST) * Math.min(Math.max(agePosition, 0), 1);
}
