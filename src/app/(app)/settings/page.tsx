import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { getSettings, getTeam } from "@/lib/data/admin";
import { getLocations } from "@/lib/data/stock";
import { PageHeader } from "@/components/ui/PageHeader";
import { CompanyForm } from "./CompanyForm";
import { TeamPanel } from "./TeamPanel";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  // The RPCs behind this page refuse anyone without full access and would
  // raise; redirecting is kinder than showing a screen of errors.
  if (!user || !hasFullAccess(user.role)) redirect("/");

  const [settings, team, locations] = await Promise.all([
    getSettings(),
    getTeam(),
    getLocations(),
  ]);

  return (
    <>
      <PageHeader title="Settings" />

      <main className="max-w-3xl px-5 py-6">
        <section className="rule bg-panel p-5">
          <h2 className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-ink">
            Company
          </h2>
          <p className="mb-4 text-sm text-ink-3">
            Shown on documents, and used to decide how early expiry warnings appear.
          </p>
          <CompanyForm settings={settings} />
        </section>

        <section className="mt-5">
          <TeamPanel
            team={team}
            locations={locations.filter((l) => l.kind !== "in_transit")}
            viewerId={user.id}
            viewerRole={user.role}
          />
        </section>
      </main>
    </>
  );
}
