import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getProduct, getLocations, getStockLevel } from "@/lib/data/stock";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProductForm } from "@/components/catalogue/ProductForm";
import { RetireProduct } from "@/components/catalogue/RetireProduct";
import { BarcodePanel } from "@/components/scan/BarcodePanel";
import { getProductBarcodes } from "@/lib/data/stock";
import { money, qty as formatQty } from "@/lib/format";
import { buttonVariants } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const [user, product, locations] = await Promise.all([
    getCurrentUser(),
    getProduct(id),
    getLocations(),
  ]);

  if (!product) notFound();
  const owner = hasFullAccess(user?.role);
  const barcodes = owner ? await getProductBarcodes(id) : [];

  const stocked = locations.filter((l) => l.kind !== "in_transit");
  const levels = await Promise.all(stocked.map((l) => getStockLevel(id, l.id)));
  const onHand = stocked.map((location, i) => ({ location, level: levels[i] }));
  const totalUnits = onHand.reduce((sum, row) => sum + Number(row.level?.qty_on_hand ?? 0), 0);

  return (
    <>
      <PageHeader
        title={product.name}
        code={product.sku}
        back={{ href: "/products", label: "products" }}
        actions={
          <Link href={`/stock/${product.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            View stock
          </Link>
        }
      />

      <main className="px-5 py-6">
        <section className="rule mb-5 bg-panel p-4">
          <h2 className="micro mb-3">Where it is</h2>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            {onHand.map(({ location, level }) => (
              <div key={location.id}>
                <dt className="micro">{location.name}</dt>
                <dd className="numeric mt-1 text-sm text-ink">
                  {formatQty(level?.qty_on_hand ?? 0)} {product.base_unit}
                </dd>
              </div>
            ))}
            {owner ? (
              <div>
                <dt className="micro">Average cost</dt>
                <dd className="numeric mt-1 text-sm text-ink">{money(product.avg_cost)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {owner ? (
          <>
            <section className="rule bg-panel p-5">
              <h2 className="mb-4 font-display text-sm font-bold uppercase tracking-wide text-ink">
                Details
              </h2>
              <ProductForm product={product} />
            </section>

            <div className="mt-5">
              <BarcodePanel
                productId={product.id}
                baseUnit={product.base_unit}
                packUnit={product.pack_unit}
                barcodes={barcodes}
              />
            </div>

            <div className="mt-5">
              <RetireProduct
                productId={product.id}
                isActive={product.is_active}
                hasStock={totalUnits > 0}
              />
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
