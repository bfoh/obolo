import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTransfer, getTransferLines } from "@/lib/data/transfers";
import { getStockLevels } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { formatDateTime, qty as formatQty } from "@/lib/format";
import { DraftLines } from "./DraftLines";
import { ReceiveForm } from "./ReceiveForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/transfers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const transfer = await getTransfer(id);
  return { title: transfer?.transfer_no ?? "Transfer" };
}

export default async function TransferPage({ params }: PageProps<"/transfers/[id]">) {
  const { id } = await params;
  const [user, transfer] = await Promise.all([getCurrentUser(), getTransfer(id)]);

  if (!transfer) notFound();

  const lines = await getTransferLines(id);
  const isDraft = transfer.status === "draft";
  const isDispatched = transfer.status === "dispatched";

  // Only offer products the source location actually holds -- a picking list
  // for stock that is not there is a wasted trip.
  const available = isDraft ? await getStockLevels(transfer.from_location_id) : [];

  const canDispatch = can(user?.role, "transferDispatch");
  const canReceive = can(user?.role, "transferReceive");

  return (
    <>
      <PageHeader
        title={transfer.transfer_no}
        back={{ href: "/transfers", label: "transfers" }}
        code={`${transfer.from_code} → ${transfer.to_code}`}
        actions={<StatusBadge tone={statusTone(transfer.status)}>{transfer.status}</StatusBadge>}
      />

      <main className="px-5 py-6">
        <dl className="rule mb-5 flex flex-wrap gap-x-8 gap-y-3 bg-panel p-4">
          <div>
            <dt className="micro">Dispatched</dt>
            <dd className="numeric mt-1 text-sm text-ink">
              {transfer.dispatched_at ? formatDateTime(transfer.dispatched_at) : "—"}
            </dd>
          </div>
          <div>
            <dt className="micro">Received</dt>
            <dd className="numeric mt-1 text-sm text-ink">
              {transfer.received_at ? formatDateTime(transfer.received_at) : "—"}
            </dd>
          </div>
          {transfer.notes ? (
            <div className="min-w-0">
              <dt className="micro">Note</dt>
              <dd className="mt-1 truncate text-sm text-ink">{transfer.notes}</dd>
            </div>
          ) : null}
        </dl>

        {isDraft ? (
          <DraftLines
            transferId={id}
            lines={lines}
            available={available}
            canDispatch={canDispatch}
          />
        ) : (
          <section className="rule bg-panel">
            <div className="border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                Lines
              </h2>
            </div>
            <ul className="divide-y divide-hairline">
              {lines.map((line) => {
                const outstanding = Number(line.qty_in_transit);
                return (
                  <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{line.product_name}</p>
                      <p className="code truncate">{line.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="numeric text-sm text-ink">
                        {formatQty(line.qty_received)} / {formatQty(line.qty_dispatched)}
                      </p>
                      <p className="code">{line.base_unit} received</p>
                      {outstanding > 0 && transfer.status === "received" ? (
                        <p className="font-display text-[10px] font-bold uppercase tracking-wider text-transit">
                          {formatQty(outstanding)} still in transit
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {isDispatched && canReceive ? (
          <div className="mt-5">
            <ReceiveForm transferId={id} lines={lines} />
          </div>
        ) : null}
      </main>
    </>
  );
}
