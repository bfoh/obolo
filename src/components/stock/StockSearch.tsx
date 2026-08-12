"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Search box that drives the list through the URL.
 *
 * Keeping the query in the URL rather than in component state means a search is
 * shareable, survives a refresh, and lets the list stay a Server Component.
 */
export function StockSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const initial = useRef(true);

  useEffect(() => {
    // Skip the first run so mounting does not immediately re-navigate.
    if (initial.current) {
      initial.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      router.replace(`${pathname}?${params}`, { scroll: false });
    }, 250);

    return () => clearTimeout(timer);
  }, [value, pathname, router, searchParams]);

  return (
    <div className="relative">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full border-2 border-line bg-panel-2 py-2.5 pl-9 pr-3 text-ink outline-none focus-visible:border-focus"
      />
    </div>
  );
}
