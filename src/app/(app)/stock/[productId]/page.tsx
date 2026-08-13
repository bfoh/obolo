import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getBatches,
  getLocationByCode,
  getLocations,
  getMovements,
  getProduct,
  getStockLevel,
} from "@/lib/data/stock";
import { PageHeader } from "@/components/ui/PageHeader";
import { BatchColumn } from "@/components/stock/BatchColumn";
import { MovementList } from "@/components/stock/MovementList";
import { isMasked, money, qty as formatQty } from "@/lib/format";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/stock/[productId]">): Promise<Metadata> {
  const { productId } = await params;
  const product = await getProduct(productId);
  return { title: product?.name ?? "Product" };
}

export default async function ProductStockPage({
  params,
  searchParams,
}: PageProps<"/stock/[productId]">) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);

  const [user, product, locations] = await Promise.all([
    getCurrentUser(),
    getProduct(productId),
    getLocations(),
  ]);

  if (!product) notFound();

  const stocked = locations.filter((l) => l.kind !== "in_transit");
  const requested = typeof query.location === "string" ? query.location : undefined;
  const fallback = await getLocationByCode("WH");
  const location =
    stocked.find((l) => l.id === requested) ?? stocked.find((l) => l.id === fallback?.id) ?? stocked[0];

  if (!location) notFound();

  const [level, batches, movements] = await Promise.all([
    getStockLevel(productId, location.id),
    getBatches(productId, location.id),
    getMovements({ productId, locationId: location.id, limit: 40 }),
  ]);

  const showsCost = can(user?.role, "cost");

  // This screen is reached from whichever floor's stock list the product was
  // tapped on, so back goes there rather than to a fixed parent.
  const backHref = location.kind === "retail" ? "/shop" : "/warehouse";
  const backLabel = location.kind === "retail" ? "the shop" : "the warehouse";

  return (
    <>
      <PageHeader title={product.name} code={product.sku} back={{ href: backHref, label: backLabel }} />

      <main className="px-5 py-6">
        {stocked.length > 1 ? (
          <nav aria-label="Location" className="mb-5 flex gap-2">
            {stocked.map((option) => (
              <Link
                key={option.id}
                href={`/stock/${productId}?location=${option.id}`}
                aria-current={option.id === location.id ? "page" : undefined}
                className={cn(
                  "press border-2 border-line px-3 py-2 font-display text-xs font-bold uppercase tracking-wider",
                  option.id === location.id
                    ? "bg-ink text-ink-invert"
                    : "bg-panel text-ink hover:bg-panel-2",
                )}
              >
                {option.name}
              </Link>
            ))}
          </nav>
        ) : null}

        <section className="rule mb-5 bg-panel p-5">
          <p className="micro">On hand at {location.name}</p>
          <p className="numeric mt-2 text-4xl font-semibold tracking-tight text-ink">
            {formatQty(level?.qty_on_hand ?? 0)}{" "}
            <span className="text-lg text-ink-3">{product.base_unit}</span>
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-4">
            {showsCost && !isMasked(level?.total_cost_value) ? (
              <>
                <div>
                  <dt className="micro">Stock value</dt>
                  <dd className="numeric mt-1 text-sm text-ink">{money(level?.total_cost_value)}</dd>
                </div>
                <div>
                  <dt className="micro">Average cost</dt>
                  <dd className="numeric mt-1 text-sm text-ink">{money(level?.avg_unit_cost)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt className="micro">
                {location.kind === "retail" ? "Retail price" : "Wholesale price"}
              </dt>
              <dd className="numeric mt-1 text-sm text-ink">
                {money(location.kind === "retail" ? product.retail_price : product.wholesale_price)}
              </dd>
            </div>
            {product.reorder_point ? (
              <div>
                <dt className="micro">Reorder at</dt>
                <dd className="numeric mt-1 text-sm text-ink">{formatQty(product.reorder_point)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <BatchColumn batches={batches} unit={product.base_unit} />
          <MovementList movements={movements} />
        </div>
      </main>
    </>
  );
}
