import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  PackagePlus,
  Receipt,
  RotateCcw,
  Settings,
  Sparkles,
  MessageSquare,
  Store,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Capability, Role } from "./permissions";
import { can } from "./permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Any one of these grants the item. Omitted for items everyone with an
   * account may open. A list matters where two roles reach the same screen
   * from opposite ends -- warehouse staff dispatch a transfer, retail staff
   * receive it, and both need the page.
   */
  capability?: Capability | Capability[];
  /**
   * Position in the mobile tab bar, lowest first. Absent means never a tab.
   *
   * A rank rather than a boolean because more destinations want a tab than
   * there are slots, and the previous `mobile: true` plus `.slice(0, 4)` broke
   * the tie by declaration order -- which silently cost an owner their Sales
   * tab. Ranking states the priority instead of letting file order decide it.
   */
  mobileRank?: number;
  group: "stock" | "trade" | "control";
}

/**
 * Tabs in the bottom bar, not counting More.
 *
 * Four plus More is five targets across the narrowest phone we support, which
 * is 78px each -- comfortably past the 44px floor, and the count iOS itself
 * settles on.
 */
export const MOBILE_TAB_SLOTS = 4;

/** Everything that does not fit a tab lives here. Mobile only. */
export const MORE_HREF = "/more";

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Valuation", icon: Gauge, mobileRank: 1, group: "stock" },
  {
    href: "/warehouse",
    label: "Warehouse",
    icon: Warehouse,
    capability: "warehouseStock",
    mobileRank: 2,
    group: "stock",
  },
  { href: "/shop", label: "Shop", icon: Store, capability: "shopStock", mobileRank: 3, group: "stock" },
  {
    href: "/transfers",
    label: "Transfers",
    icon: ArrowLeftRight,
    capability: ["transferDispatch", "transferReceive"],
    // Ranked below Sales: staff who dispatch transfers also sell, and selling
    // happens many times a day where a transfer happens a few times a week.
    mobileRank: 5,
    group: "stock",
  },
  { href: "/receive", label: "Receive", icon: PackagePlus, capability: "receive", group: "stock" },
  // Everyone may look at the catalogue; only the owner may change a price.
  { href: "/products", label: "Products", icon: Boxes, group: "stock" },

  {
    href: "/sales",
    label: "Sales",
    icon: Receipt,
    capability: ["wholesaleSale", "retailSale"],
    mobileRank: 4,
    group: "trade",
  },
  { href: "/customers", label: "Customers", icon: Users, capability: "customers", group: "trade" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, capability: "suppliers", group: "trade" },
  {
    href: "/purchase-orders",
    label: "Orders",
    icon: ClipboardList,
    capability: "suppliers",
    group: "trade",
  },
  { href: "/returns", label: "Returns", icon: RotateCcw, capability: "returns", group: "trade" },

  { href: "/counts", label: "Counts", icon: ClipboardCheck, capability: "countSubmit", group: "control" },
  { href: "/reports", label: "Reports", icon: TrendingUp, capability: "reports", group: "control" },
  { href: "/insights", label: "Insights", icon: Sparkles, capability: "insights", group: "control" },
  // Everyone gets the assistant; what it can do is filtered by their role.
  { href: "/assistant", label: "Assistant", icon: MessageSquare, group: "control" },
  { href: "/settings", label: "Settings", icon: Settings, capability: "settings", group: "control" },
];

/** Everything this role may open, in declaration order. */
export function navFor(role: Role | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!item.capability) return true;
    const required = Array.isArray(item.capability) ? item.capability : [item.capability];
    return required.some((capability) => can(role, capability));
  });
}

/**
 * The tabs in the mobile bottom bar, best first.
 *
 * Sorted by `mobileRank` before the cut, so the destination that loses its slot
 * is the one ranked lowest rather than the one declared last. Whatever does not
 * fit is still reachable: BottomNav appends a More tab, and `moreNavFor()`
 * returns everything.
 */
export function mobileNavFor(role: Role | null | undefined): NavItem[] {
  return navFor(role)
    .filter((item) => item.mobileRank !== undefined)
    .sort((a, b) => a.mobileRank! - b.mobileRank!)
    .slice(0, MOBILE_TAB_SLOTS);
}

/**
 * Everything a role can open, for the More sheet.
 *
 * Deliberately the full list rather than "whatever missed a tab". People look
 * for a destination where they last found it, and a menu that hides the four
 * things already on screen makes the other twelve harder to trust.
 */
export function moreNavFor(role: Role | null | undefined) {
  return navGroupsFor(role);
}

export function navGroupsFor(role: Role | null | undefined) {
  const items = navFor(role);
  return (["stock", "trade", "control"] as const)
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}
