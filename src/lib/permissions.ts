/**
 * Role → capability matrix.
 *
 * This decides what the UI offers. It is NOT the enforcement layer: cost
 * masking lives in the `public.v_*` views via `is_owner()`, and write
 * authorization lives in `core.can_post()` inside the posting RPCs. Its job is
 * to avoid showing someone a button the database will refuse, and to keep that
 * decision in one tested place instead of scattered `role === "owner"` checks.
 *
 * Kept deliberately in step with the SQL. If a capability changes here it must
 * change in the migrations too, or the UI will offer an action that fails.
 */

export type Role = "owner" | "warehouse_staff" | "retail_staff";

export type Capability =
  /** See cost, margin, and stock value anywhere in the app. */
  | "cost"
  | "warehouseStock"
  | "shopStock"
  | "receive"
  | "transferDispatch"
  | "transferReceive"
  | "wholesaleSale"
  | "retailSale"
  | "customers"
  | "suppliers"
  | "countSubmit"
  /** Approve and post a count, turning a variance into a stock adjustment. */
  | "countApprove"
  | "returns"
  | "writeOff"
  | "reports"
  | "insights"
  | "reverseMovement"
  | "closePeriod"
  | "manageUsers"
  | "settings";

const MATRIX: Record<Capability, Record<Role, boolean>> = {
  // Cost, margin and valuation are owner-only. This is the whole point of the
  // private `core` schema and the masked views; staff never see it anywhere.
  cost: { owner: true, warehouse_staff: false, retail_staff: false },

  warehouseStock: { owner: true, warehouse_staff: true, retail_staff: false },
  shopStock: { owner: true, warehouse_staff: false, retail_staff: true },

  receive: { owner: true, warehouse_staff: true, retail_staff: false },
  transferDispatch: { owner: true, warehouse_staff: true, retail_staff: false },
  transferReceive: { owner: true, warehouse_staff: false, retail_staff: true },

  wholesaleSale: { owner: true, warehouse_staff: true, retail_staff: false },
  retailSale: { owner: true, warehouse_staff: false, retail_staff: true },

  // Warehouse staff sell wholesale on credit, so they need the customer ledger.
  customers: { owner: true, warehouse_staff: true, retail_staff: false },
  suppliers: { owner: true, warehouse_staff: true, retail_staff: false },

  countSubmit: { owner: true, warehouse_staff: true, retail_staff: true },
  // Submitting and approving a count are split on purpose. If the person who
  // counts can also post the variance, a shortfall can be counted away without
  // anyone seeing it. This split is the main control against shrinkage.
  countApprove: { owner: true, warehouse_staff: false, retail_staff: false },

  returns: { owner: true, warehouse_staff: false, retail_staff: true },
  writeOff: { owner: true, warehouse_staff: true, retail_staff: true },

  reports: { owner: true, warehouse_staff: false, retail_staff: false },
  insights: { owner: true, warehouse_staff: false, retail_staff: false },
  reverseMovement: { owner: true, warehouse_staff: false, retail_staff: false },
  closePeriod: { owner: true, warehouse_staff: false, retail_staff: false },
  manageUsers: { owner: true, warehouse_staff: false, retail_staff: false },
  settings: { owner: true, warehouse_staff: false, retail_staff: false },
};

/**
 * Fails closed. An unresolved, unknown or suspended role gets nothing --
 * never more than a known-restricted role.
 */
export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  const row = MATRIX[capability];
  if (!row) return false;
  return row[role] ?? false;
}

export function isOwner(role: Role | null | undefined): boolean {
  return role === "owner";
}

/** Every capability a role holds. Used for tests and debugging, not hot paths. */
export function capabilitiesFor(role: Role | null | undefined): Capability[] {
  return (Object.keys(MATRIX) as Capability[]).filter((c) => can(role, c));
}
