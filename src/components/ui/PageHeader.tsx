import type { ReactNode } from "react";

/**
 * Sticky page header. `pt-safe` keeps the title clear of the notch when the
 * PWA runs fullscreen on a phone.
 */
export function PageHeader({
  title,
  code,
  actions,
}: {
  title: string;
  /** Document or location identifier, e.g. "GRN-00231" or "WH · A-04". */
  code?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-line bg-surface px-5 pt-safe">
      <div className="flex min-h-16 items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-ink">{title}</h1>
          {code ? <p className="code mt-0.5 truncate">{code}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
