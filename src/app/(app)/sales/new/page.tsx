import type { Metadata } from "next";
import { getCustomers } from "@/lib/data/sales";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewSaleForm } from "./NewSaleForm";

export const metadata: Metadata = { title: "New sale" };
export const dynamic = "force-dynamic";

export default async function NewSalePage() {
  const user = await getCurrentUser();
  // Retail staff work the till; warehouse staff sell wholesale. Offer only what
  // the person can actually post.
  const channels = [
    can(user?.role, "wholesaleSale") ? ("wholesale" as const) : null,
    can(user?.role, "retailSale") ? ("retail" as const) : null,
  ].filter((c): c is "wholesale" | "retail" => c !== null);

  const customers = can(user?.role, "customers") ? await getCustomers() : [];

  return (
    <>
      <PageHeader title="New sale" />
      <main className="px-5 py-6">
        <div className="rule max-w-lg bg-panel p-5">
          <NewSaleForm channels={channels} customers={customers} />
        </div>
      </main>
    </>
  );
}
