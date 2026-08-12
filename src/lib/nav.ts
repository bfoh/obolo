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
  /** Shown in the mobile bottom bar. At most four, plus the action button. */
  mobile?: boolean;
  group: "stock" | "trade" | "control";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Valuation", icon: Gauge, mobile: true, group: "stock" },
  {
    href: "/warehouse",
    label: "Warehouse",
    icon: Warehouse,
    capability: "warehouseStock",
    mobile: true,
    group: "stock",
  },
  { href: "/shop", label: "Shop", icon: Store, capability: "shopStock", mobile: true, group: "stock" },
  {
    href: "/transfers",
    label: "Transfers",
    icon: ArrowLeftRight,
    capability: ["transferDispatch", "transferReceive"],
    mobile: true,
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
    mobile: true,
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
 * The mobile bottom bar. Capped at four so tap targets stay above 44px on a
 * small phone; anything beyond that lives behind the "More" route.
 */
export function mobileNavFor(role: Role | null | undefined): NavItem[] {
  return navFor(role)
    .filter((item) => item.mobile)
    .slice(0, 4);
}

export function navGroupsFor(role: Role | null | undefined) {
  const items = navFor(role);
  return (["stock", "trade", "control"] as const)
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}
