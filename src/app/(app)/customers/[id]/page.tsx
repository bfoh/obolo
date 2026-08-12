import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCustomer, getCustomerLedger } from "@/lib/data/sales";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Statement } from "@/components/trade/Statement";
import { PaymentPanel } from "@/components/trade/PaymentPanel";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const customer = await getCustomer(id);
  return { title: customer?.name ?? "Customer" };
}

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const [user, customer] = await Promise.all([getCurrentUser(), getCustomer(id)]);

  if (!customer || !can(user?.role, "customers")) notFound();

  const ledger = await getCustomerLedger(id);
  const owes = Number(customer.balance);

  return (
    <>
      <PageHeader title={customer.name} code={customer.code} />

      <main className="px-5 py-6">
        <section className="rule mb-5 bg-panel p-5">
          <p className="micro">{owes < 0 ? "In credit" : "Owes"}</p>
          <p className="numeric mt-2 text-4xl font-semibold tracking-tight text-ink">
            {money(Math.abs(owes))}
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-4">
            <div>
              <dt className="micro">Credit limit</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(customer.credit_limit)}</dd>
            </div>
            <div>
              <dt className="micro">Still available</dt>
              <dd className="numeric mt-1 text-sm text-ink">{money(customer.credit_available)}</dd>
            </div>
            {customer.payment_terms_days > 0 ? (
              <div>
                <dt className="micro">Terms</dt>
                <dd className="numeric mt-1 text-sm text-ink">{customer.payment_terms_days} days</dd>
              </div>
            ) : null}
            {customer.phone ? (
              <div>
                <dt className="micro">Phone</dt>
                <dd className="numeric mt-1 text-sm text-ink">{customer.phone}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <div className="mb-5">
          <PaymentPanel customerId={customer.id} customerName={customer.name} />
        </div>

        <Statement entries={ledger} />
      </main>
    </>
  );
}
