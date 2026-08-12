import { cn } from "@/lib/utils";

const TONE = {
  draft: "border-hairline bg-panel-sunk text-ink-3",
  open: "border-transit bg-transit-soft text-transit",
  done: "border-tally bg-tally-soft text-tally",
  dead: "border-hairline bg-panel-sunk text-ink-3 line-through",
} as const;

export type StatusTone = keyof typeof TONE;

export function StatusBadge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block border-2 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Transfer and delivery statuses share a vocabulary; keep them in one place. */
export function statusTone(status: string): StatusTone {
  switch (status) {
    case "draft":
      return "draft";
    case "dispatched":
      return "open";
    case "received":
    case "posted":
      return "done";
    case "cancelled":
    case "reversed":
      return "dead";
    default:
      return "draft";
  }
}
