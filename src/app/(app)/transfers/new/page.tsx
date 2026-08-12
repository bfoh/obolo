import type { Metadata } from "next";
import { getLocations } from "@/lib/data/stock";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewTransferForm } from "./NewTransferForm";

export const metadata: Metadata = { title: "New transfer" };
export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  const locations = (await getLocations()).filter((l) => l.kind !== "in_transit");

  return (
    <>
      <PageHeader title="New transfer" />
      <main className="px-5 py-6">
        <div className="rule max-w-lg bg-panel p-5">
          <NewTransferForm locations={locations} />
        </div>
      </main>
    </>
  );
}
