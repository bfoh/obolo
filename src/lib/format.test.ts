import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatDate,
  isMasked,
  money,
  moneyCompact,
  percent,
  plural,
  qty,
  qtyWithUnit,
} from "./format";

describe("isMasked", () => {
  it("treats null and undefined as masked", () => {
    expect(isMasked(null)).toBe(true);
    expect(isMasked(undefined)).toBe(true);
  });

  // A staff user sees NULL for cost; a real zero-cost line is a different fact.
  it("does not treat zero as masked", () => {
    expect(isMasked(0)).toBe(false);
    expect(isMasked("0.000000")).toBe(false);
  });
});

describe("money", () => {
  it("formats a Postgres numeric string at 2dp", () => {
    expect(money("1600.000000")).toBe("₵1,600.00");
  });

  it("formats a number", () => {
    expect(money(12.5)).toBe("₵12.50");
  });

  it("rounds 6dp storage down to 2dp display", () => {
    expect(money("10.123456")).toBe("₵10.12");
    expect(money("10.126000")).toBe("₵10.13");
  });

  it("renders a placeholder for masked cost rather than ₵0.00", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined, { fallback: "hidden" })).toBe("hidden");
  });

  it("distinguishes a genuine zero from a masked value", () => {
    expect(money(0)).toBe("₵0.00");
  });

  it("puts the minus sign before the symbol", () => {
    expect(money("-450.5")).toBe("-₵450.50");
  });

  it("shows an explicit plus for signed ledger deltas", () => {
    expect(money(200, { signed: true })).toBe("+₵200.00");
    expect(money(-200, { signed: true })).toBe("-₵200.00");
  });

  it("omits the symbol when the column already heads it", () => {
    expect(money("1600", { bare: true })).toBe("1,600.00");
  });

  it("falls back when the value is not parseable", () => {
    expect(money("not-a-number")).toBe("—");
  });
});

describe("qty", () => {
  // A warehouse counts 12 cartons, not 12.000 cartons.
  it("renders whole quantities without decimals", () => {
    expect(qty("12.000")).toBe("12");
    expect(qty(150)).toBe("150");
  });

  it("keeps fractional quantities for weight and volume", () => {
    expect(qty("2.500")).toBe("2.5");
    expect(qty("0.125")).toBe("0.125");
  });

  it("groups thousands", () => {
    expect(qty("12000")).toBe("12,000");
  });

  it("appends a unit without pluralising it", () => {
    expect(qtyWithUnit("12", "carton")).toBe("12 carton");
    expect(qtyWithUnit("12", null)).toBe("12");
  });
});

describe("moneyCompact", () => {
  it("abbreviates thousands and millions", () => {
    expect(moneyCompact(1_500)).toBe("₵1.5K");
    expect(moneyCompact(24_000)).toBe("₵24K");
    expect(moneyCompact(1_500_000)).toBe("₵1.5M");
    expect(moneyCompact(24_000_000)).toBe("₵24M");
  });

  it("uses the full figure below a thousand", () => {
    expect(moneyCompact(950)).toBe("₵950.00");
  });

  it("keeps the sign", () => {
    expect(moneyCompact(-1_500)).toBe("-₵1.5K");
  });
});

describe("percent", () => {
  it("formats a ratio supplied by the server", () => {
    expect(percent(0.235)).toBe("23.5%");
  });

  it("returns a placeholder when masked", () => {
    expect(percent(null)).toBe("—");
  });
});

describe("formatDate", () => {
  // Pinned to UTC: a phone on the wrong timezone must not shift a movement
  // onto the previous day.
  it("formats in UTC regardless of viewer timezone", () => {
    expect(formatDate("2026-03-15T23:30:00Z")).toBe("15 Mar 2026");
  });

  it("returns a placeholder for missing or invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-08-11T09:00:00Z");

  it("counts forward to an expiry date", () => {
    expect(daysUntil("2026-08-21", now)).toBe(10);
  });

  it("returns zero on the day itself", () => {
    expect(daysUntil("2026-08-11T23:59:00Z", now)).toBe(0);
  });

  it("goes negative once expired", () => {
    expect(daysUntil("2026-08-01", now)).toBe(-10);
  });

  it("returns null when there is no expiry", () => {
    expect(daysUntil(null, now)).toBe(null);
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "batch", "batches")).toBe("1 batch");
    expect(plural(1, "product")).toBe("1 product");
  });

  it("uses the plural for anything else, including zero", () => {
    expect(plural(0, "product")).toBe("0 products");
    expect(plural(3, "product")).toBe("3 products");
  });

  it("takes an explicit plural for irregular words", () => {
    expect(plural(2, "batch", "batches")).toBe("2 batches");
  });

  it("groups thousands", () => {
    expect(plural(1200, "product")).toBe("1,200 products");
  });
});
