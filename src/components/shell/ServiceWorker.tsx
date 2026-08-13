"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CloudOff } from "lucide-react";

/**
 * Registers the service worker, and tells people when the line is down.
 *
 * Registration is production-only. In development the assets are not
 * content-hashed the same way and a cache-first worker turns every edit into a
 * hard-refresh hunt.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // After load, so registration never competes with the first paint for
    // bandwidth on a connection that has little to spare.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration is not worth surfacing: the app works without
        // it, and there is nothing the person holding the phone can do.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return <OfflineNotice />;
}

/**
 * `navigator.onLine` only reports whether there is a link, not whether anything
 * is reachable across it -- on a Ghanaian mobile network those differ often.
 * So this is framed as "no connection" rather than "you are offline", and it
 * appears rather than blocking: a false negative must not stop someone working.
 */
function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b-2 border-signal bg-signal px-4 py-1.5 text-white pt-safe"
    >
      <CloudOff size={14} aria-hidden />
      <span className="font-display text-[11px] font-bold uppercase tracking-wider">
        No connection — nothing will save
      </span>
    </div>
  );
}

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
