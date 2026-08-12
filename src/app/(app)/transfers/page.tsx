import { ArrowLeftRight, Plus } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTransfers } from "@/lib/data/transfers";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { buttonVariants } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Transfers" };
export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const [user, transfers] = await Promise.all([getCurrentUser(), getTransfers()]);
  const canDispatch = can(user?.role, "transferDispatch");

  return (
    <>
      <PageHeader
        title="Transfers"
        actions={
          canDispatch ? (
            <Link href="/transfers/new" className={buttonVariants({ size: "sm" })}>
              <Plus size={14} aria-hidden />
              New transfer
            </Link>
          ) : null
        }
      />

      <main className="px-5 py-6">
        {transfers.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers yet"
            description="Move stock from the warehouse to the shop. Goods stay tracked in transit until someone confirms what arrived."
            action={
              canDispatch ? (
                <Link href="/transfers/new" className={buttonVariants()}>
                  New transfer
                </Link>
              ) : null
            }
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {transfers.map((transfer) => (
              <li key={transfer.id}>
                <Link
                  href={`/transfers/${transfer.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-ink">
                      <span className="numeric">{transfer.transfer_no}</span>
                      <StatusBadge tone={statusTone(transfer.status)}>{transfer.status}</StatusBadge>
                    </p>
                    <p className="code mt-0.5 truncate">
                      {transfer.from_code} → {transfer.to_code} ·{" "}
                      {formatDateTime(transfer.dispatched_at ?? transfer.created_at)}
                    </p>
                  </div>
                  <ArrowLeftRight size={16} className="shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
