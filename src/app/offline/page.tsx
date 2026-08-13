import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { GyeNyame } from "@/components/brand/GyeNyame";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown by the service worker when a navigation cannot reach the server.
 *
 * Deliberately static and public: it is precached at install, so it must render
 * without a session, without a database and without anything personal on it.
 * That is also why it lives outside the `(app)` route group -- the app layout
 * resolves the current user and would redirect.
 *
 * The copy says what happened and what to do, and does not apologise. It is
 * also careful not to claim anything it cannot know: the app cannot tell
 * whether a movement posted before the line dropped, so it says to check rather
 * than to retry.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3.5">
          <GyeNyame className="h-10 w-auto shrink-0 text-ink" title="Gye Nyame" />
          <span className="font-display text-4xl font-extrabold tracking-tight text-ink">
            OBOLO
          </span>
        </div>

        <div className="rule bg-panel p-6">
          <CloudOff size={26} strokeWidth={1.6} className="text-ink-3" aria-hidden />

          <h1 className="mt-4 font-display text-xl font-bold text-ink">No connection</h1>

          <p className="mt-2 text-sm text-ink-3">
            OBOLO could not reach the server. The app itself loaded from this device, so
            this is the network, not the app.
          </p>

          <p className="mt-4 text-sm text-ink-3">
            If you were recording something when the line dropped, open it again once you
            are back on and check whether it went through before entering it a second time.
          </p>

          {/*
            A real anchor, not next/link, and the lint rule is wrong here.
            <Link> does a client-side navigation: it would ask the router to
            fetch an RSC payload over the connection that just failed, and the
            page would sit there. A full document load is what "try again"
            has to mean on this screen.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="press mt-6 block w-full rule bg-ink px-4 py-3 text-center font-display text-sm font-bold uppercase tracking-wider text-ink-invert"
          >
            Try again
          </a>
        </div>
      </div>
    </main>
  );
}
