import { AlertTriangle, ArrowRight, PackagePlus, TrendingDown, Truck } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getExpiringSoon, getLowStock, getValuationSummary } from "@/lib/data/stock";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ValueTile } from "@/components/valuation/ValueTile";
import { Odometer } from "@/components/ui/Odometer";
import { formatDateTime, isMasked, money, plural, qty as formatQty } from "@/lib/format";

export const metadata: Metadata = { title: "Valuation" };

// Stock moves constantly; a cached valuation is a wrong valuation.
export const dynamic = "force-dynamic";

export default async function ValuationPage() {
  const user = await getCurrentUser();
  const showsCost = can(user?.role, "cost");
  const now = new Date();

  const [positions, lowStock, expiring] = await Promise.all([
    getValuationSummary(now),
    getLowStock(),
    getExpiringSoon(),
  ]);

  const warehouse = positions.find((p) => p.location_kind === "warehouse");
  const transit = positions.find((p) => p.location_kind === "in_transit");
  const hasStock = positions.some((p) => Number(p.qty_on_hand) > 0);

  // Anything still sitting in transit was dispatched and never confirmed. It is
  // a discrepancy, not a balance, so it is called out rather than just listed.
  const transitResidual = transit && Number(transit.qty_on_hand) > 0 ? transit : null;

  // Whether the headline figure is shown at all. Staff never see value, so for
  // them the warehouse tile is the only place the position appears and must
  // not be hidden on narrow screens.
  const hero = showsCost && warehouse !== undefined;

  return (
    <>
      <PageHeader title="Valuation" code={`As of ${formatDateTime(now)} UTC`} />

      <main className="px-5 py-6">
        {hero ? (
          <section className="mb-4 border-2 border-line bg-panel p-5 sm:mb-6 sm:p-6">
            <p className="micro">Warehouse stock value</p>
            <p className="numeric mt-2 text-4xl font-semibold tracking-tight text-ink sm:mt-3 sm:text-5xl xl:text-6xl">
              <Odometer value={money(warehouse!.total_value)} />
            </p>
            <p className="mt-2 text-sm text-ink-3 sm:mt-3">
              <span className="numeric">{formatQty(warehouse!.qty_on_hand)}</span> units across{" "}
              <span className="numeric">{plural(warehouse!.product_count, "product")}</span>
            </p>
          </section>
        ) : null}

        {/* With nothing in stock the instruction IS the page, so it comes
            before three tiles reading zero. Buried under them it sat 211px
            below the fold on a phone -- the only action on the screen, and
            invisible without scrolling. */}
        {!hasStock ? (
          <div className="mb-4 sm:mb-6">
            <EmptyState
              icon={PackagePlus}
              title="No stock recorded yet"
              description="Receive your first delivery into the warehouse. Every receipt creates a costed batch, and the value above updates as stock moves."
              action={
                can(user?.role, "receive") ? (
                  <Link
                    href="/receive"
                    className="press inline-block rule bg-ink px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wider text-ink-invert"
                  >
                    Receive stock
                  </Link>
                ) : null
              }
            />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {positions.map((position) => (
            <ValueTile
              key={position.location_id}
              label={position.location_name}
              code={position.location_code}
              value={position.total_value}
              units={position.qty_on_hand}
              skus={position.product_count}
              tone={position.location_kind === "in_transit" ? "transit" : "neutral"}
              // The hero already IS the warehouse position. On a wide grid the
              // repeat costs one cell; stacked on a phone it costs a whole
              // screen, so the tile is dropped there and restored at `sm`.
              className={hero && position.location_kind === "warehouse" ? "hidden sm:flex" : undefined}
            />
          ))}
        </div>

        {transitResidual ? (
          <section className="mt-6 border-2 border-transit bg-transit-soft p-5">
            <div className="flex items-start gap-3">
              <Truck size={20} className="mt-0.5 shrink-0 text-transit" aria-hidden />
              <div className="min-w-0">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                  Stock unaccounted for in transit
                </h2>
                <p className="mt-1 text-sm text-ink-2">
                  <span className="numeric">{formatQty(transitResidual.qty_on_hand)}</span> units
                  {isMasked(transitResidual.total_value) ? null : (
                    <>
                      {" "}worth <span className="numeric">{money(transitResidual.total_value)}</span>
                    </>
                  )}{" "}
                  left the warehouse and were never confirmed at their destination. Receive them, or
                  write them off with a reason.
                </p>
                <Link
                  href="/transfers"
                  className="mt-3 inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-transit hover:underline"
                >
                  Open transfers <ArrowRight size={13} aria-hidden />
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {/* The empty state moved above the tiles; only the alerts belong here,
            and only once there is stock for them to be about. */}
        {hasStock ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <AlertPanel
              icon={TrendingDown}
              title="Running low"
              empty="Nothing is below its reorder point."
              rows={lowStock.map((row) => ({
                key: `${row.product_id}-${row.location_id}`,
                href: `/stock/${row.product_id}?location=${row.location_id}`,
                primary: row.product_name,
                code: `${row.sku} · ${row.location_code}`,
                value: `${formatQty(row.qty_on_hand)} left`,
                tone: "warn" as const,
              }))}
            />

            <AlertPanel
              icon={AlertTriangle}
              title="Expiring soon"
              empty="Nothing is close to expiry."
              rows={expiring.map((row) => ({
                key: row.batch_id,
                href: `/stock/${row.product_id}?location=${row.location_id}`,
                primary: row.product_name,
                code: `${row.lot_code ?? "no lot"} · ${row.location_code}`,
                value:
                  row.days_remaining < 0 ? "Expired" : `${row.days_remaining}d left`,
                tone: row.days_remaining < 0 ? ("signal" as const) : ("warn" as const),
              }))}
            />
          </div>
        ) : null}
      </main>
    </>
  );
}

function AlertPanel({
  icon: Icon,
  title,
  empty,
  rows,
}: {
  icon: typeof AlertTriangle;
  title: string;
  empty: string;
  rows: {
    key: string;
    href: string;
    primary: string;
    code: string;
    value: string;
    tone: "warn" | "signal";
  }[];
}) {
  return (
    <section className="rule bg-panel">
      <div className="flex items-center gap-2 border-b-2 border-line px-4 py-3">
        <Icon size={15} className="text-ink-3" aria-hidden />
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">{title}</h2>
        {rows.length > 0 ? <span className="code ml-auto">{rows.length}</span> : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">{empty}</p>
      ) : (
        <ul>
          {rows.slice(0, 6).map((row) => (
            <li key={row.key} className="border-b border-hairline last:border-b-0">
              <Link
                href={row.href}
                className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-panel-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{row.primary}</p>
                  <p className="code truncate">{row.code}</p>
                </div>
                <span
                  className={`numeric shrink-0 text-sm ${
                    row.tone === "signal" ? "text-signal" : "text-warn"
                  }`}
                >
                  {row.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
