import type { MovementType } from "./data/types";

/**
 * How each movement type is named and coloured in the interface.
 *
 * Labels are what a person in the warehouse would say, not the enum. Nobody
 * says "expiry_writeoff" -- they say the stock expired.
 */
const LABELS: Record<MovementType, string> = {
  opening_balance: "Opening balance",
  receipt: "Received",
  transfer_out: "Sent out",
  transfer_in: "Brought in",
  wholesale_sale: "Sold wholesale",
  retail_sale: "Sold retail",
  customer_return: "Customer return",
  supplier_return: "Returned to supplier",
  damage: "Damaged",
  expiry_writeoff: "Expired",
  count_increase: "Count gain",
  count_decrease: "Count loss",
};

export function movementLabel(type: MovementType): string {
  return LABELS[type] ?? type;
}

export type MovementTone = "in" | "out" | "loss";

/**
 * Losses are separated from ordinary outbound movements. A sale and a
 * write-off both reduce stock, but only one of them is a problem, and a stock
 * screen that colours them identically hides exactly what someone is scanning
 * the history to find.
 */
export function movementTone(type: MovementType): MovementTone {
  switch (type) {
    case "damage":
    case "expiry_writeoff":
    case "count_decrease":
      return "loss";
    case "receipt":
    case "transfer_in":
    case "customer_return":
    case "count_increase":
    case "opening_balance":
      return "in";
    default:
      return "out";
  }
}

/** Sign of a movement type, matching core.movement_direction() in SQL. */
export function movementDirection(type: MovementType): 1 | -1 {
  return movementTone(type) === "in" ? 1 : -1;
}
