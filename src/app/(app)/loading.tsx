import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The default loading shell for every screen in the app.
 *
 * Its real job is not this markup -- it is that Next cannot stream a route
 * without a loading boundary. Before this file existed there were none, so the
 * layout's awaits blocked the whole render and the screen stayed blank for
 * every round trip, then painted all at once. With a boundary, the rail, the
 * bottom bar and this shell paint immediately and the data fills in behind.
 *
 * Individual routes can override it by adding their own `loading.tsx`; the
 * valuation page does, because it is the one people open first.
 */
export default function Loading() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b-2 border-line bg-surface px-5 pt-safe">
        <div className="flex min-h-16 items-center py-3">
          <Skeleton className="h-7 w-40" />
        </div>
      </header>

      <PageSkeleton label="Loading">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </PageSkeleton>
    </>
  );
}
