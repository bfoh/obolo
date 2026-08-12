import { RotateCcw } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getReturns } from "@/lib/data/counts";
import { getCustomers } from "@/lib/data/sales";
import { getLocations, getStockLevels, getLocationByCode } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { NewReturnPanel } from "@/components/trade/NewReturnPanel";
import { WriteOffPanel } from "@/components/trade/WriteOffPanel";
import { formatDate, money } from "@/lib/format";

export const metadata: Metadata = { title: "Returns" };
export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const [user, returns, locations] = await Promise.all([
    getCurrentUser(),
    getReturns(),
    getLocations(),
  ]);

  const canReturn = can(user?.role, "returns");
  const canWriteOff = can(user?.role, "writeOff");
  const customers = can(user?.role, "customers") ? await getCustomers() : [];
  const stocked = locations.filter((l) => l.kind !== "in_transit");

  // The write-off panel needs something to write off.
  const shop = await getLocationByCode("SHOP");
  const defaultLocation = stocked.find((l) => l.id === shop?.id) ?? stocked[0];
  const stock = defaultLocation ? await getStockLevels(defaultLocation.id) : [];

  return (
    <>
      <PageHeader
        title="Returns"
        actions={canReturn ? <NewReturnPanel customers={customers} locations={stocked} /> : null}
      />

      <main className="px-5 py-6">
        {canWriteOff && defaultLocation ? (
          <div className="mb-5">
            <WriteOffPanel location={defaultLocation} stock={stock} />
          </div>
        ) : null}

        {returns.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="No returns yet"
            description="Take goods back from a customer. Resalable stock goes back to the batch it came from at the cost it left at; damaged goods are credited but never re-enter stock."
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {returns.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/returns/${row.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-ink">
                      <span className="numeric">{row.return_no}</span>
                      <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                    </p>
                    <p className="code mt-0.5 truncate">
                      {row.customer_name ?? "No customer"} · {row.location_code} ·{" "}
                      {formatDate(row.occurred_at)}
                    </p>
                  </div>
                  <p className="numeric shrink-0 text-sm text-ink">{money(row.credit_total)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
