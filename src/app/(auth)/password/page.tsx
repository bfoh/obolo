import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { GyeNyame } from "@/components/brand/GyeNyame";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Password" };
export const dynamic = "force-dynamic";

/**
 * Lives outside the (app) route group deliberately.
 *
 * The app layout redirects here whenever `must_change_password` is set, so if
 * this page sat inside that group the redirect would loop. Being outside also
 * gives the forced case the right shape: one thing to do, nothing to navigate
 * to, the same full-screen treatment as signing in.
 */
export default async function PasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const forced = user.mustChangePassword;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="flex items-center gap-3.5">
            <GyeNyame className="h-12 w-auto shrink-0 text-ink" title="Gye Nyame" />
            <h1 className="font-display text-5xl font-extrabold tracking-tight text-ink">OBOLO</h1>
          </div>
          <p className="micro mt-3">{user.email ?? user.fullName}</p>
        </div>

        <div className="rule bg-panel p-6">
          <h2 className="font-display text-lg font-bold text-ink">
            {forced ? "Choose your own password" : "Change your password"}
          </h2>
          <p className="mt-1.5 text-sm text-ink-3">
            {forced
              ? "You are signed in with a password someone else set for you. Pick one only you know before carrying on."
              : "You will stay signed in on this device."}
          </p>

          <PasswordForm forced={forced} />
        </div>
      </div>
    </main>
  );
}
