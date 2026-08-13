import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Sticky page header. `pt-safe` keeps the title clear of the notch when the
 * PWA runs fullscreen on a phone.
 *
 * `back` takes an href rather than calling `router.back()`. History is empty
 * when a screen is opened from a notification, a shared link, or a cold start
 * of the installed app, and a back button that does nothing on those paths is
 * worse than none. An explicit parent always works.
 *
 * Mobile only, by design. The side rail already says where you are on a
 * desktop, so a second affordance there would be chrome for its own sake --
 * but in a standalone PWA there is no browser back button, and without this a
 * detail screen is a dead end.
 */
export function PageHeader({
  title,
  code,
  actions,
  back,
}: {
  title: string;
  /** Document or location identifier, e.g. "GRN-00231" or "WH · A-04". */
  code?: string;
  actions?: ReactNode;
  /** Where "back" goes. Set it on detail routes; leave it off on list routes. */
  back?: { href: string; label: string };
}) {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-surface px-5 pt-safe">
      <div className="flex min-h-16 items-center justify-between gap-4 py-3">
        <div className="flex min-w-0 items-center gap-1">
          {back ? (
            <Link
              href={back.href}
              aria-label={`Back to ${back.label}`}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center text-ink-2 hover:text-ink md:hidden"
            >
              <ChevronLeft size={22} aria-hidden />
            </Link>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-bold text-ink">{title}</h1>
            {code ? <p className="code mt-0.5 truncate">{code}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
