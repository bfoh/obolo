import type { Metadata } from "next";
import { LocationStockView } from "@/components/stock/LocationStockView";

export const metadata: Metadata = { title: "Warehouse" };
export const dynamic = "force-dynamic";

export default async function WarehousePage({ searchParams }: PageProps<"/warehouse">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  return <LocationStockView code="WH" search={q} />;
}
