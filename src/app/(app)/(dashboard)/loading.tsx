import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * Valuation, specifically. This is the screen the app opens on, so its shell is
 * worth matching to the real layout rather than using the generic one: the hero
 * figure, then the location tiles at their mobile height.
 */
export default function Loading() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b-2 border-line bg-surface px-5 pt-safe">
        <div className="flex min-h-16 flex-col justify-center gap-1.5 py-3">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-3 w-52" />
        </div>
      </header>

      <PageSkeleton label="Loading the valuation">
        <div className="mb-4 border-2 border-line bg-panel p-5 sm:mb-6 sm:p-6">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="mt-3 h-10 w-56 sm:h-12" />
          <Skeleton className="mt-3 h-4 w-40" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {[0, 1].map((i) => (
            <div key={i} className="border-2 border-line bg-panel p-4 sm:p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-8 w-32 sm:mt-4 sm:h-9" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
          ))}
        </div>
      </PageSkeleton>
    </>
  );
}
