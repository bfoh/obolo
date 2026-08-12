import { describe, expect, it } from "vitest";
import { bandOpacity, buildBatchColumn, type BatchInput } from "./batchColumn";

// `in` rather than `??` so a test can pass an explicit null for a masked cost
// without it being replaced by the default.
const batch = (over: Partial<BatchInput> & { id: string; qty: string }): BatchInput => ({
  id: over.id,
  lot_code: over.lot_code ?? null,
  qty_remaining: over.qty,
  unit_cost: "unit_cost" in over ? (over.unit_cost ?? null) : "10.000000",
  remaining_value: "remaining_value" in over ? (over.remaining_value ?? null) : null,
  origin_received_at: over.origin_received_at ?? "2026-01-01T00:00:00Z",
  expiry_date: over.expiry_date ?? null,
});

const sumHeights = (bands: { heightPercent: number }[]) =>
  Math.round(bands.reduce((s, b) => s + b.heightPercent, 0));

describe("buildBatchColumn", () => {
  it("returns an empty column when there is no stock", () => {
    const column = buildBatchColumn([]);
    expect(column.bands).toEqual([]);
    expect(column.totalQty).toBe(0);
    expect(column.batchCount).toBe(0);
  });

  it("ignores depleted batches", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "0.000" }),
      batch({ id: "b", qty: "50.000" }),
    ]);
    expect(column.batchCount).toBe(1);
    expect(column.bands[0].id).toBe("b");
  });

  it("totals the remaining quantity", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "100.000" }),
      batch({ id: "b", qty: "50.000" }),
    ]);
    expect(column.totalQty).toBe(150);
  });

  it("reports each band's true share regardless of drawn height", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "75.000" }),
      batch({ id: "b", qty: "25.000" }),
    ]);
    expect(column.bands[0].share).toBeCloseTo(0.75);
    expect(column.bands[1].share).toBeCloseTo(0.25);
  });

  it("always fills the column exactly", () => {
    for (const quantities of [["10"], ["10", "20"], ["1", "1", "1", "97"], ["5", "5", "5", "5", "5"]]) {
      const column = buildBatchColumn(quantities.map((q, i) => batch({ id: `b${i}`, qty: q })));
      expect(sumHeights(column.bands)).toBe(100);
    }
  });

  // A 2-unit batch beside a 5,000-unit one would round away, and the column
  // would then lie about how many strata exist.
  it("keeps a tiny band visible next to a huge one", () => {
    const column = buildBatchColumn([
      batch({ id: "tiny", qty: "2.000" }),
      batch({ id: "huge", qty: "5000.000" }),
    ]);
    expect(column.bands[0].heightPercent).toBeGreaterThanOrEqual(4);
    expect(column.heightsAdjusted).toBe(true);
  });

  it("keeps the bigger batch visibly bigger even after flooring", () => {
    const column = buildBatchColumn([
      batch({ id: "tiny", qty: "2.000" }),
      batch({ id: "huge", qty: "5000.000" }),
    ]);
    expect(column.bands[1].heightPercent).toBeGreaterThan(column.bands[0].heightPercent);
  });

  it("falls back to equal bands when too many to floor", () => {
    const many = Array.from({ length: 40 }, (_, i) => batch({ id: `b${i}`, qty: "10.000" }));
    const column = buildBatchColumn(many);
    expect(sumHeights(column.bands)).toBe(100);
    expect(column.bands.every((b) => Math.abs(b.heightPercent - 2.5) < 0.001)).toBe(true);
  });

  it("does not flag adjustment when heights are already to scale", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "50.000" }),
      batch({ id: "b", qty: "50.000" }),
    ]);
    expect(column.heightsAdjusted).toBe(false);
  });

  // The first band is what a sale or transfer will consume next.
  it("marks the oldest band as the next to be drawn", () => {
    const column = buildBatchColumn([
      batch({ id: "old", qty: "10.000", origin_received_at: "2026-01-01T00:00:00Z" }),
      batch({ id: "new", qty: "10.000", origin_received_at: "2026-06-01T00:00:00Z" }),
    ]);
    expect(column.bands[0].isNext).toBe(true);
    expect(column.bands[1].isNext).toBe(false);
  });

  it("ramps age from oldest to newest", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "10" }),
      batch({ id: "b", qty: "10" }),
      batch({ id: "c", qty: "10" }),
    ]);
    expect(column.bands.map((b) => b.agePosition)).toEqual([0, 0.5, 1]);
  });

  it("treats a lone band as neither old nor new", () => {
    const column = buildBatchColumn([batch({ id: "only", qty: "10" })]);
    expect(column.bands[0].agePosition).toBe(0);
  });

  it("carries masked cost through as null rather than zero", () => {
    const column = buildBatchColumn([
      batch({ id: "a", qty: "10", unit_cost: null, remaining_value: null }),
    ]);
    expect(column.bands[0].unitCost).toBeNull();
    expect(column.bands[0].remainingValue).toBeNull();
  });

  it("survives an unparseable quantity instead of drawing NaN", () => {
    const column = buildBatchColumn([batch({ id: "a", qty: "not-a-number" })]);
    expect(column.bands).toEqual([]);
  });
});

describe("bandOpacity", () => {
  it("draws the oldest band darkest", () => {
    expect(bandOpacity(0)).toBeGreaterThan(bandOpacity(1));
  });

  it("stays within the ramp for out-of-range input", () => {
    expect(bandOpacity(-5)).toBe(bandOpacity(0));
    expect(bandOpacity(99)).toBe(bandOpacity(1));
  });

  it("never fades a band to invisible", () => {
    expect(bandOpacity(1)).toBeGreaterThan(0.25);
  });
});
