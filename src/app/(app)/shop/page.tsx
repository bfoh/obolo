import type { Metadata } from "next";
import { LocationStockView } from "@/components/stock/LocationStockView";

export const metadata: Metadata = { title: "Retail shop" };
export const dynamic = "force-dynamic";

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  return <LocationStockView code="SHOP" search={q} />;
}
