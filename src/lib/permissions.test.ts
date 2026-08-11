import { describe, expect, it } from "vitest";
import { can, capabilitiesFor, isOwner, type Role } from "./permissions";

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

describe("isOwner", () => {
  it("recognises only the owner", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("warehouse_staff")).toBe(false);
    expect(isOwner(null)).toBe(false);
  });
});
