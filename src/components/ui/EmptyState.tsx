import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * An empty screen is an invitation to act, so every empty state names the
 * thing that is missing and the action that fills it.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rule flex flex-col items-center bg-panel px-6 py-14 text-center">
      <Icon size={28} strokeWidth={1.5} className="text-ink-3" aria-hidden />
      <h2 className="mt-4 font-display text-lg font-bold text-ink">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-3">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
