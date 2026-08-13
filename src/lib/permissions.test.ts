import { describe, expect, it } from "vitest";
import {
  can,
  canManageMember,
  capabilitiesFor,
  grantableRoles,
  hasFullAccess,
  isOwner,
  type Role,
} from "./permissions";

const STAFF_ROLES: Role[] = ["warehouse_staff", "retail_staff"];

describe("can", () => {
  it("gives the owner every capability", () => {
    expect(capabilitiesFor("owner")).toHaveLength(capabilitiesFor("owner").length);
    for (const capability of capabilitiesFor("owner")) {
      expect(can("owner", capability)).toBe(true);
    }
  });

  // The app's central control: staff record movements, they never see money.
  it("hides cost from every staff role", () => {
    for (const role of STAFF_ROLES) {
      expect(can(role, "cost")).toBe(false);
      expect(can(role, "reports")).toBe(false);
    }
  });

  it("fails closed for an unresolved role", () => {
    expect(can(null, "warehouseStock")).toBe(false);
    expect(can(undefined, "cost")).toBe(false);
    expect(capabilitiesFor(null)).toEqual([]);
  });

  it("fails closed for a role that is not in the matrix", () => {
    expect(can("superuser" as Role, "cost")).toBe(false);
  });

  it("separates the two floors", () => {
    expect(can("warehouse_staff", "warehouseStock")).toBe(true);
    expect(can("warehouse_staff", "shopStock")).toBe(false);
    expect(can("retail_staff", "shopStock")).toBe(true);
    expect(can("retail_staff", "warehouseStock")).toBe(false);
  });

  it("splits the transfer into a dispatch side and a receive side", () => {
    expect(can("warehouse_staff", "transferDispatch")).toBe(true);
    expect(can("warehouse_staff", "transferReceive")).toBe(false);
    expect(can("retail_staff", "transferReceive")).toBe(true);
    expect(can("retail_staff", "transferDispatch")).toBe(false);
  });

  it("routes each sale channel to the role that works that counter", () => {
    expect(can("warehouse_staff", "wholesaleSale")).toBe(true);
    expect(can("warehouse_staff", "retailSale")).toBe(false);
    expect(can("retail_staff", "retailSale")).toBe(true);
    expect(can("retail_staff", "wholesaleSale")).toBe(false);
  });

  // Whoever counts the stock must not be the one who posts the variance,
  // or a shortfall can be counted away without anyone seeing it.
  it("lets staff submit a count but never approve one", () => {
    for (const role of STAFF_ROLES) {
      expect(can(role, "countSubmit")).toBe(true);
      expect(can(role, "countApprove")).toBe(false);
    }
    expect(can("owner", "countApprove")).toBe(true);
  });

  it("keeps ledger corrections and period closing with the owner", () => {
    for (const role of STAFF_ROLES) {
      expect(can(role, "reverseMovement")).toBe(false);
      expect(can(role, "closePeriod")).toBe(false);
      expect(can(role, "manageUsers")).toBe(false);
      expect(can(role, "settings")).toBe(false);
    }
  });

  it("gives warehouse staff the customer ledger they need for credit sales", () => {
    expect(can("warehouse_staff", "customers")).toBe(true);
    expect(can("retail_staff", "customers")).toBe(false);
  });
});

// An admin is an owner for every capability question. This is asserted rather
// than assumed, because the two are separate values in the enum and a matrix
// written role by role would drift apart one line at a time.
describe("admin", () => {
  it("holds exactly the capabilities an owner holds, and no others", () => {
    expect(capabilitiesFor("admin")).toEqual(capabilitiesFor("owner"));
  });

  it("sees cost, because it is standing in for the owner", () => {
    expect(can("admin", "cost")).toBe(true);
    expect(can("admin", "reports")).toBe(true);
    expect(can("admin", "manageUsers")).toBe(true);
    expect(can("admin", "countApprove")).toBe(true);
  });
});

describe("hasFullAccess", () => {
  it("covers the owner and the admin standing in for one", () => {
    expect(hasFullAccess("owner")).toBe(true);
    expect(hasFullAccess("admin")).toBe(true);
  });

  it("covers no staff role and no unresolved role", () => {
    for (const role of STAFF_ROLES) expect(hasFullAccess(role)).toBe(false);
    expect(hasFullAccess(null)).toBe(false);
    expect(hasFullAccess(undefined)).toBe(false);
  });
});

describe("isOwner", () => {
  // Narrower than hasFullAccess on purpose: it answers "may this person touch
  // an owner account", which is the one thing an admin may not do.
  it("recognises only the owner, and not an admin", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(isOwner("warehouse_staff")).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});

describe("grantableRoles", () => {
  it("lets an owner hand out anything, including owner", () => {
    expect(grantableRoles("owner")).toContain("owner");
    expect(grantableRoles("owner")).toContain("admin");
  });

  // The whole point of keeping admin and owner apart: an added administrator
  // must not be able to manufacture a second owner.
  it("never lets an admin hand out owner", () => {
    expect(grantableRoles("admin")).not.toContain("owner");
    expect(grantableRoles("admin")).toEqual(["admin", "warehouse_staff", "retail_staff"]);
  });

  it("gives staff and unresolved roles nothing to hand out", () => {
    for (const role of STAFF_ROLES) expect(grantableRoles(role)).toEqual([]);
    expect(grantableRoles(null)).toEqual([]);
  });
});

describe("canManageMember", () => {
  it("lets an owner manage anyone but themselves", () => {
    expect(canManageMember("owner", "admin", false)).toBe(true);
    expect(canManageMember("owner", "owner", false)).toBe(true);
    expect(canManageMember("owner", "owner", true)).toBe(false);
  });

  it("lets an admin manage staff and other admins", () => {
    expect(canManageMember("admin", "warehouse_staff", false)).toBe(true);
    expect(canManageMember("admin", "admin", false)).toBe(true);
  });

  it("stops an admin reaching an owner's account", () => {
    expect(canManageMember("admin", "owner", false)).toBe(false);
  });

  // Suspending or demoting yourself is the one mistake nobody can undo alone.
  it("stops anyone editing their own row", () => {
    expect(canManageMember("admin", "admin", true)).toBe(false);
  });

  it("gives staff no management at all", () => {
    for (const role of STAFF_ROLES) {
      expect(canManageMember(role, "retail_staff", false)).toBe(false);
    }
    expect(canManageMember(null, "retail_staff", false)).toBe(false);
  });
});
