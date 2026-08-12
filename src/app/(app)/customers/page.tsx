import { Users } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getCustomers } from "@/lib/data/sales";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewCustomerPanel } from "@/components/trade/NewCustomerPanel";
import { StockSearch } from "@/components/stock/StockSearch";
import { money, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";

  const [user, customers] = await Promise.all([getCurrentUser(), getCustomers(q)]);
  const canManage = can(user?.role, "customers");

  return (
    <>
      <PageHeader
        title="Customers"
        code={plural(customers.length, "customer")}
        actions={canManage ? <NewCustomerPanel /> : null}
      />

      <main className="px-5 py-6">
        <div className="mb-4 w-full sm:max-w-sm">
          <StockSearch placeholder="Search name, code or phone" />
        </div>

        {customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "Nothing matches that search" : "No customers yet"}
            description={
              q
                ? "Try a different name, code or phone number."
                : "Add the traders you sell to. A credit limit decides how much they can take before paying."
            }
            action={canManage && !q ? <NewCustomerPanel openByDefault /> : null}
          />
        ) : (
          <ul className="rule divide-y divide-hairline bg-panel">
            {customers.map((customer) => {
              const owes = Number(customer.balance);
              return (
                <li key={customer.id}>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-panel-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{customer.name}</p>
                      <p className="code truncate">
                        {customer.code}
                        {customer.phone ? ` · ${customer.phone}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {owes > 0 ? (
                        <p className="numeric text-sm text-warn">{money(customer.balance)} owing</p>
                      ) : owes < 0 ? (
                        <p className="numeric text-sm text-tally">
                          {money(Math.abs(owes))} in credit
                        </p>
                      ) : (
                        <p className="numeric text-sm text-ink-3">settled</p>
                      )}
                      {Number(customer.credit_limit) > 0 ? (
                        <p className="code">{money(customer.credit_available)} left</p>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
