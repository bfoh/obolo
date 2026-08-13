import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { AskReports } from "./AskReports";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!hasFullAccess(user?.role)) redirect("/");

  return (
    <>
      <PageHeader title="Reports" code="Ask in plain words" />
      <main className="px-5 py-6">
        <AskReports />
      </main>
    </>
  );
}
