import { cn } from "@/lib/utils";

/**
 * Placeholder shapes for a screen whose data has not arrived.
 *
 * Deliberately plain: a shape in `panel-sunk` with a slow pulse, never a
 * shimmer sweep. On a slow connection these can be on screen for seconds, and
 * an animation that reads as "something is happening" for 200ms reads as
 * agitation for five.
 *
 * `motion-reduce:animate-none` because a full-page pulse is exactly the kind of
 * thing the reduced-motion preference exists for.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse bg-panel-sunk motion-reduce:animate-none", className)}
    />
  );
}

/**
 * The shell of a page that is still loading, matching the real layout closely
 * enough that nothing jumps when the data lands.
 *
 * A `role="status"` with an `sr-only` label, so a screen reader is told the
 * page is loading rather than being read a wall of empty boxes.
 */
export function PageSkeleton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div role="status" aria-live="polite" className="px-5 py-6">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
