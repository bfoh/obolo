import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "press inline-flex items-center justify-center gap-2 border-2 font-display font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "border-line bg-ink text-ink-invert",
        secondary: "border-line bg-panel text-ink hover:bg-panel-2",
        danger: "border-signal bg-signal text-white",
        quiet: "border-transparent bg-transparent text-ink-2 shadow-none hover:text-ink",
      },
      size: {
        // min-h-11 keeps every control at the 44px tap floor.
        md: "min-h-11 px-4 py-2.5 text-xs",
        sm: "min-h-9 px-3 py-2 text-[11px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
