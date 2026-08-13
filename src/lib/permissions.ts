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

/**
 * The STORED role, as `public.me()` reports it.
 *
 * `admin` holds every capability `owner` does -- the database says so too, by
 * resolving a stored admin to an effective role of owner inside
 * `public.current_user_role()`. The two are kept apart here for the same reason
 * they are kept apart there: an admin may not create, promote to, demote or
 * suspend an owner, and the team screen has to be able to say which is which.
 */
export type Role = "owner" | "admin" | "warehouse_staff" | "retail_staff";

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

/**
 * `admin` is deliberately absent from the matrix. It is collapsed onto `owner`
 * in `can()` instead, mirroring what `public.current_user_role()` does in SQL,
 * so the two cannot drift apart one capability at a time.
 */
type BaseRole = Exclude<Role, "admin">;

const MATRIX: Record<Capability, Record<BaseRole, boolean>> = {
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
  return row[effectiveRole(role)] ?? false;
}

/**
 * The role every capability question is actually answered against. An admin is
 * an owner here exactly as `public.current_user_role()` makes them one in SQL;
 * if that mapping ever changes, it changes in both places or not at all.
 */
function effectiveRole(role: Role): BaseRole {
  return role === "admin" ? "owner" : role;
}

/**
 * Holds every capability: an owner, or an admin acting with the same rights.
 *
 * This is the check for gating a screen or an action. It is what the database
 * enforces independently through `is_owner()`, so the two agree.
 */
export function hasFullAccess(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Strictly the owner, and not an admin standing in for one.
 *
 * Only for the one asymmetry between them: an admin may not create, promote to,
 * demote or suspend an owner. Reach for `hasFullAccess()` for anything else, or
 * admins start failing gates the database will happily let them through.
 */
export function isOwner(role: Role | null | undefined): boolean {
  return role === "owner";
}

/** Every capability a role holds. Used for tests and debugging, not hot paths. */
export function capabilitiesFor(role: Role | null | undefined): Capability[] {
  return (Object.keys(MATRIX) as Capability[]).filter((c) => can(role, c));
}

/**
 * The roles `role` may hand out.
 *
 * Owners grant anything. Admins grant everything except `owner`, so an added
 * administrator cannot manufacture a second owner and cannot be talked into
 * doing it. `public.add_team_member()` refuses the same thing in SQL; this
 * keeps the form from offering an option the database will reject.
 */
export function grantableRoles(role: Role | null | undefined): Role[] {
  if (role === "owner") return ["owner", "admin", "warehouse_staff", "retail_staff"];
  if (role === "admin") return ["admin", "warehouse_staff", "retail_staff"];
  return [];
}

/** Whether `actor` may change `target`'s role or status. Mirrors update_team_member(). */
export function canManageMember(
  actor: Role | null | undefined,
  target: Role,
  isSelf: boolean,
): boolean {
  if (!hasFullAccess(actor)) return false;
  // Nobody edits their own role or status; the person who could undo it is you.
  if (isSelf) return false;
  return target !== "owner" || isOwner(actor);
}
