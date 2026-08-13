import { Boxes } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { searchProducts } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { can, hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewProductPanel } from "@/components/catalogue/NewProductPanel";
import { StockSearch } from "@/components/stock/StockSearch";
import { money, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";

  const [user, products] = await Promise.all([getCurrentUser(), searchProducts(q, 300)]);
  const owner = hasFullAccess(user?.role);
  const showsCost = can(user?.role, "cost");

  return (
    <>
      <PageHeader
        title="Products"
        code={plural(products.length, "product")}
        actions={owner ? <NewProductPanel /> : null}
      />

      <main className="px-5 py-6">
        <div className="mb-4 w-full sm:max-w-sm">
          <StockSearch placeholder="Search name or SKU" />
        </div>

        {products.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={q ? "Nothing matches that search" : "No products yet"}
            description={
              q
                ? "Try a different name or SKU."
                : "Add what you buy and sell. You will need at least one before you can record a delivery."
            }
            action={owner && !q ? <NewProductPanel openByDefault /> : null}
          />
        ) : (
          <div className="rule overflow-x-auto bg-panel">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-line bg-panel-sunk">
                  <th scope="col" className="micro px-4 py-2.5">Product</th>
                  <th scope="col" className="micro px-4 py-2.5 text-right">Wholesale</th>
                  <th scope="col" className="micro px-4 py-2.5 text-right">Retail</th>
                  {showsCost ? (
                    <th scope="col" className="micro px-4 py-2.5 text-right">Last cost</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-hairline last:border-b-0 hover:bg-panel-2"
                  >
                    <td className="px-4 py-2.5">
                      <Link href={`/products/${product.id}`} className="block min-h-11 py-1">
                        <span className="block truncate text-sm text-ink">{product.name}</span>
                        <span className="code block truncate">
                          {product.sku} · per {product.base_unit}
                          {product.is_active ? "" : " · retired"}
                        </span>
                      </Link>
                    </td>
                    <td className="numeric px-4 py-2.5 text-right align-top text-sm text-ink">
                      {money(product.wholesale_price)}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right align-top text-sm text-ink">
                      {money(product.retail_price)}
                    </td>
                    {showsCost ? (
                      <td className="numeric px-4 py-2.5 text-right align-top text-sm text-ink-2">
                        {money(product.last_cost)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
