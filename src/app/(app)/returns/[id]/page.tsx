import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReturn, getReturnLines } from "@/lib/data/counts";
import { searchProducts } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, statusTone } from "@/components/ui/StatusBadge";
import { DraftReturn } from "./DraftReturn";
import { formatDateTime, money, qty as formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/returns/[id]">): Promise<Metadata> {
  const { id } = await params;
  const row = await getReturn(id);
  return { title: row?.return_no ?? "Return" };
}

export default async function ReturnPage({ params }: PageProps<"/returns/[id]">) {
  const { id } = await params;
  const [user, row] = await Promise.all([getCurrentUser(), getReturn(id)]);

  if (!row) notFound();

  const lines = await getReturnLines(id);
  const isDraft = row.status === "draft";
  const canReturn = can(user?.role, "returns");
  const products = isDraft && canReturn ? await searchProducts("", 300) : [];

  return (
    <>
      <PageHeader
        title={row.return_no}
        back={{ href: "/returns", label: "returns" }}
        code={`${row.customer_name ?? "No customer"} · ${row.location_code} · ${formatDateTime(row.occurred_at)}`}
        actions={<StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>}
      />

      <main className="px-5 py-6">
        {row.reason ? (
          <p className="rule mb-5 bg-panel px-4 py-3 text-sm text-ink">{row.reason}</p>
        ) : null}

        {isDraft && canReturn ? (
          <DraftReturn returnId={id} row={row} lines={lines} products={products} />
        ) : (
          <section className="rule bg-panel">
            <div className="flex items-center justify-between gap-3 border-b-2 border-line px-4 py-3">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
                What came back
              </h2>
              <span className="numeric text-sm text-ink">{money(row.credit_total)} credited</span>
            </div>
            <ul className="divide-y divide-hairline">
              {lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{line.product_name}</p>
                    <p className="code truncate">
                      {formatQty(line.qty)} {line.base_unit} ·{" "}
                      {line.condition === "damaged" ? "damaged — not restocked" : "back in stock"}
                    </p>
                  </div>
                  <span className="numeric shrink-0 text-sm text-ink">{money(line.line_total)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
