import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { DismissInsight } from "./DismissInsight";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

const SEVERITY = {
  critical: "border-signal bg-signal-soft text-signal",
  warn: "border-warn bg-warn-soft text-warn",
  info: "border-line bg-panel text-ink",
} as const;

interface InsightRow {
  id: string;
  kind: string;
  severity: keyof typeof SEVERITY;
  headline: string;
  generated_at: string;
  product_name: string | null;
  location_code: string | null;
}

export default async function InsightsPage() {
  const user = await getCurrentUser();
  if (!hasFullAccess(user?.role)) redirect("/");

  const supabase = await createClient();
  const { data } = await supabase.from("v_ai_insights").select("*").limit(30);
  const insights = (data ?? []) as InsightRow[];

  return (
    <>
      <PageHeader title="Insights" code="Written overnight from your own numbers" />

      <main className="px-5 py-6">
        {insights.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Nothing worth flagging"
            description="Insights are written overnight from what actually moved. Silence means nothing needed your attention — it is a valid answer, not a failure to run."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {insights.map((insight) => (
              <li key={insight.id} className={cn("border-2 p-4", SEVERITY[insight.severity])}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="micro">
                      {insight.kind.replace("_", " ")}
                      {insight.location_code ? ` · ${insight.location_code}` : ""}
                    </p>
                    <p className="mt-1.5 text-sm text-ink">{insight.headline}</p>
                    <p className="code mt-1">{formatDateTime(insight.generated_at)}</p>
                  </div>
                  <DismissInsight id={insight.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
