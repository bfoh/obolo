import { describe, expect, it } from "vitest";
import { movementDirection, movementLabel, movementTone } from "./movements";
import type { MovementType } from "./data/types";

const ALL: MovementType[] = [
  "opening_balance",
  "receipt",
  "transfer_out",
  "transfer_in",
  "wholesale_sale",
  "retail_sale",
  "customer_return",
  "supplier_return",
  "damage",
  "expiry_writeoff",
  "count_increase",
  "count_decrease",
];

describe("movementLabel", () => {
  it("names every movement type in plain words", () => {
    for (const type of ALL) {
      const label = movementLabel(type);
      expect(label).not.toBe("");
      expect(label).not.toContain("_");
    }
  });
});

describe("movementDirection", () => {
  // Must agree with core.movement_direction() in the SQL, or the UI will show
  // a movement going the opposite way from how it was posted.
  it("matches the directions the database enforces", () => {
    const inbound: MovementType[] = [
      "opening_balance",
      "receipt",
      "transfer_in",
      "customer_return",
      "count_increase",
    ];
    const outbound: MovementType[] = [
      "transfer_out",
      "wholesale_sale",
      "retail_sale",
      "supplier_return",
      "damage",
      "expiry_writeoff",
      "count_decrease",
    ];

    for (const type of inbound) expect(movementDirection(type)).toBe(1);
    for (const type of outbound) expect(movementDirection(type)).toBe(-1);
    expect(inbound.length + outbound.length).toBe(ALL.length);
  });
});

describe("movementTone", () => {
  it("separates losses from ordinary outbound movements", () => {
    expect(movementTone("damage")).toBe("loss");
    expect(movementTone("expiry_writeoff")).toBe("loss");
    expect(movementTone("count_decrease")).toBe("loss");
    expect(movementTone("wholesale_sale")).toBe("out");
    expect(movementTone("transfer_out")).toBe("out");
  });

  it("gives every type a tone", () => {
    for (const type of ALL) {
      expect(["in", "out", "loss"]).toContain(movementTone(type));
    }
  });
});
