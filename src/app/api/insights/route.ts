import { generateObject } from "ai";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const MODEL = "anthropic/claude-sonnet-5";

const Insights = z.object({
  insights: z
    .array(
      z.object({
        kind: z.enum(["reorder", "dead_stock", "shrinkage", "expiry", "anomaly"]),
        severity: z.enum(["info", "warn", "critical"]),
        headline: z
          .string()
          .describe("One sentence a busy owner can act on. Name the product and the number."),
      }),
    )
    .max(8),
});

/**
 * The nightly read of the business.
 *
 * Runs on a schedule with no user session, so it uses the service role -- and
 * is therefore gated on a shared secret rather than a login. The numbers are
 * computed in SQL; the model's only job is deciding which of them are worth
 * waking someone up about and saying so in a sentence.
 *
 * It cannot change anything. There is no write tool here at all.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const [reorder, dead, shrink, expiring] = await Promise.all([
    supabase.rpc("report_reorder_suggestions"),
    supabase.rpc("report_dead_stock", { p_days: 60 }),
    supabase.rpc("report_shrinkage", { p_days: 30 }),
    supabase.rpc("report_expiring", { p_days: 30 }),
  ]);

  const facts = {
    needs_reordering: reorder.data ?? [],
    not_moving: dead.data ?? [],
    lost_to_damage_or_shortfall: shrink.data ?? [],
    expiring: expiring.data ?? [],
  };

  const nothingToSay = Object.values(facts).every((rows) => (rows as unknown[]).length === 0);
  if (nothingToSay) {
    return Response.json({ written: 0, reason: "nothing worth reporting" });
  }

  const result = await generateObject({
    model: MODEL,
    schema: Insights,
    prompt: [
      "You are reading the overnight numbers for a Ghanaian wholesale warehouse.",
      "Pick out only what genuinely deserves the owner's attention tomorrow morning.",
      "",
      "Rules:",
      "- At most eight. Fewer is better. Silence is a valid answer.",
      "- Every headline names the product and the actual number. No vague warnings.",
      "- Amounts are Ghana cedis, written as GHS 1,234.",
      "- 'critical' means money is being lost now or stock runs out within days.",
      "- Do not repeat the same product across several insights.",
      "- Do not invent anything that is not in the data below.",
      "",
      JSON.stringify(facts),
    ].join("\n"),
  });

  for (const insight of result.object.insights) {
    await supabase.rpc("ai_write_insight", {
      p_kind: insight.kind,
      p_severity: insight.severity,
      p_headline: insight.headline,
      p_model: MODEL,
    });
  }

  await supabase.rpc("ai_record_usage", {
    p_feature: "insights",
    p_model: MODEL,
    p_input_tokens: result.usage?.inputTokens ?? 0,
    p_output_tokens: result.usage?.outputTokens ?? 0,
    p_cost_usd:
      ((result.usage?.inputTokens ?? 0) / 1_000_000) * 3.0 +
      ((result.usage?.outputTokens ?? 0) / 1_000_000) * 15.0,
  });

  return Response.json({ written: result.object.insights.length });
}
