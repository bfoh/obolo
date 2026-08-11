"use client";

import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "obolo-theme";

/**
 * Light/dark toggle.
 *
 * Holds no React state. The current theme already lives in one place -- the
 * class on <html>, applied before first paint by the inline script in
 * app/layout.tsx -- so mirroring it into state would mean two sources of truth,
 * a cascading render, and a hydration mismatch on the first paint. The icon is
 * chosen by CSS from that same class, and the click handler reads it back from
 * the DOM.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    root.classList.toggle("light", !next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage blocked in private browsing: the toggle still works for this
      // session, it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      className="flex h-9 w-9 items-center justify-center border-2 border-bitumen-700 text-concrete-300 transition-colors hover:text-concrete-50"
    >
      <Sun size={16} aria-hidden className="block dark:hidden" />
      <Moon size={16} aria-hidden className="hidden dark:block" />
    </button>
  );
}
