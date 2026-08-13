import type { Metadata } from "next";
import { getLocations } from "@/lib/data/stock";
import { getSuppliers } from "@/lib/data/receipts";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewReceiptForm } from "./NewReceiptForm";

export const metadata: Metadata = { title: "New delivery" };
export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  const [locations, suppliers] = await Promise.all([getLocations(), getSuppliers()]);
  const stocked = locations.filter((l) => l.kind !== "in_transit");

  return (
    <>
      <PageHeader title="New delivery" back={{ href: "/receive", label: "deliveries" }} />
      <main className="px-5 py-6">
        <div className="rule max-w-lg bg-panel p-5">
          <NewReceiptForm locations={stocked} suppliers={suppliers} />
        </div>
      </main>
    </>
  );
}
