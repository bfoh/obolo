import { describe, expect, it } from "vitest";
import {
  mobileNavFor,
  moreNavFor,
  navFor,
  navGroupsFor,
  MOBILE_TAB_SLOTS,
  NAV_ITEMS,
} from "./nav";
import type { Role } from "./permissions";

const hrefs = (role: Role | null) => navFor(role).map((i) => i.href);
const ROLES: Role[] = ["owner", "admin", "warehouse_staff", "retail_staff"];

/** Everything a phone can open: the tabs, plus everything behind More. */
const reachableOnMobile = (role: Role) => [
  ...mobileNavFor(role).map((i) => i.href),
  ...moreNavFor(role).flatMap((g) => g.items.map((i) => i.href)),
];

describe("navFor", () => {
  it("gives the owner every destination", () => {
    expect(hrefs("owner")).toHaveLength(NAV_ITEMS.length);
  });

  it("gives an admin the same destinations as the owner, settings included", () => {
    expect(hrefs("admin")).toEqual(hrefs("owner"));
    expect(hrefs("admin")).toContain("/settings");
  });

  it("shows nothing but the unguarded routes to an unresolved role", () => {
    expect(hrefs(null)).toEqual(["/", "/products", "/assistant"]);
  });

  it("keeps warehouse staff out of the shop and vice versa", () => {
    expect(hrefs("warehouse_staff")).toContain("/warehouse");
    expect(hrefs("warehouse_staff")).not.toContain("/shop");
    expect(hrefs("retail_staff")).toContain("/shop");
    expect(hrefs("retail_staff")).not.toContain("/warehouse");
  });

  // Warehouse staff dispatch, retail staff receive. Both need the page, so
  // gating it on the dispatch capability alone would strand retail staff.
  it("shows transfers to both floors", () => {
    expect(hrefs("warehouse_staff")).toContain("/transfers");
    expect(hrefs("retail_staff")).toContain("/transfers");
  });

  it("shows sales to whichever counter the role works", () => {
    expect(hrefs("warehouse_staff")).toContain("/sales");
    expect(hrefs("retail_staff")).toContain("/sales");
  });

  it("hides reports, insights and settings from staff", () => {
    for (const role of ["warehouse_staff", "retail_staff"] as Role[]) {
      expect(hrefs(role)).not.toContain("/reports");
      expect(hrefs(role)).not.toContain("/insights");
      expect(hrefs(role)).not.toContain("/settings");
    }
  });
});

// The regression this whole file exists to prevent. Before the More route,
// a phone reached 4 of an owner's 16 destinations and nothing said so.
describe("mobile reachability", () => {
  it("leaves no destination unreachable on a phone, for any role", () => {
    for (const role of ROLES) {
      const reachable = reachableOnMobile(role);
      for (const href of hrefs(role)) {
        expect(reachable, `${role} cannot reach ${href} on a phone`).toContain(href);
      }
    }
  });

  it("reaches everything in at most two taps", () => {
    // A tab is one tap. Anything else is More, then the link: two.
    for (const role of ROLES) {
      const tabs = mobileNavFor(role).map((i) => i.href);
      const behindMore = moreNavFor(role).flatMap((g) => g.items.map((i) => i.href));
      for (const href of hrefs(role)) {
        expect(tabs.includes(href) || behindMore.includes(href)).toBe(true);
      }
    }
  });

  // The bug that cost an owner their Sales tab: five items flagged for mobile,
  // four slots, and declaration order broke the tie.
  it("drops the lowest-ranked tab, not the last-declared one", () => {
    const ownerTabs = mobileNavFor("owner").map((i) => i.href);
    expect(ownerTabs).toContain("/sales");
    expect(ownerTabs).not.toContain("/transfers");
    expect(moreNavFor("owner").flatMap((g) => g.items.map((i) => i.href))).toContain("/transfers");
  });

  it("orders tabs by rank rather than by position in the file", () => {
    for (const role of ROLES) {
      const ranks = mobileNavFor(role).map((i) => i.mobileRank!);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe("mobileNavFor", () => {
  it("never exceeds four tabs, so tap targets stay above 44px", () => {
    for (const role of [...ROLES, null] as (Role | null)[]) {
      expect(mobileNavFor(role).length).toBeLessThanOrEqual(MOBILE_TAB_SLOTS);
    }
  });

  it("only offers tabs the role can actually open", () => {
    const retail = mobileNavFor("retail_staff").map((i) => i.href);
    expect(retail).not.toContain("/warehouse");
  });

  it("always leads with valuation, the app's primary job", () => {
    expect(mobileNavFor("owner")[0].href).toBe("/");
  });
});

describe("navGroupsFor", () => {
  it("drops groups a role has no items in", () => {
    // An unresolved role keeps only the unguarded routes, so the whole trade
    // group disappears rather than rendering an empty heading.
    expect(navGroupsFor(null).map((g) => g.group)).toEqual(["stock", "control"]);
    expect(navGroupsFor(null).map((g) => g.group)).not.toContain("trade");
  });

  it("returns all three groups for the owner", () => {
    expect(navGroupsFor("owner").map((g) => g.group)).toEqual(["stock", "trade", "control"]);
  });

  it("leaves retail staff a control group without reports or settings", () => {
    const control = navGroupsFor("retail_staff").find((g) => g.group === "control");
    expect(control?.items.map((i) => i.href)).toEqual(["/counts", "/assistant"]);
  });
});
