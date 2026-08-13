"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";
import { signOut } from "@/app/(auth)/actions";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  /**
   * Empty the service worker's caches on the way out.
   *
   * It only ever holds content-addressed assets, which carry no user data, so
   * this is not fixing a known leak. It is here because "the cache is emptied
   * when someone signs out" stays true as the app changes, whereas "the cache
   * never happens to hold anything personal" is a property someone has to keep
   * re-establishing every time a caching rule is touched.
   */
  function clearWorkerCaches() {
    navigator.serviceWorker?.controller?.postMessage({ type: "OBOLO_SIGN_OUT" });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        clearWorkerCaches();
        startTransition(() => signOut());
      }}
      aria-label="Sign out"
      className="flex h-9 w-9 items-center justify-center border-2 border-bitumen-700 text-concrete-300 transition-colors hover:text-signal-400 disabled:opacity-50"
    >
      <LogOut size={16} aria-hidden />
    </button>
  );
}
