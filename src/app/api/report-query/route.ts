import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const MODEL = "anthropic/claude-sonnet-5";

/**
 * Answers a question in words by choosing a report, not by writing SQL.
 *
 * The model picks one of these and its arguments. That is the entire surface it
 * can reach. Letting it compose a query would hand it everything the connection
 * can read, which is exactly what the private `core` schema exists to prevent --
 * and no prompt is a substitute for that.
 */
const REPORTS = {
  stock_value_over_time: {
    rpc: "report_stock_value_series",
    describe: "How the value of stock has moved day by day, per location.",
    args: z.object({ p_days: z.number().int().min(1).max(365).default(30) }),
  },
  margin_by_product: {
    rpc: "report_margin_by_product",
    describe: "Revenue, cost and margin for each product sold in a period.",
    args: z.object({ p_days: z.number().int().min(1).max(365).default(30) }),
  },
  dead_stock: {
    rpc: "report_dead_stock",
    describe: "Stock that has not moved, and how much money is tied up in it.",
    args: z.object({ p_days: z.number().int().min(1).max(365).default(60) }),
  },
  shrinkage: {
    rpc: "report_shrinkage",
    describe: "Stock lost to damage, expiry or counted-away shortfalls.",
    args: z.object({ p_days: z.number().int().min(1).max(365).default(90) }),
  },
  reorder_suggestions: {
    rpc: "report_reorder_suggestions",
    describe: "What is running out, how fast it is going, and how much to buy.",
    args: z.object({}),
  },
} as const;

type ReportName = keyof typeof REPORTS;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  // Every report here returns cost or margin.
  if (!user || !hasFullAccess(user.role)) {
    return Response.json({ error: "Reports are for the owner." }, { status: 403 });
  }

  const supabase = await createClient();

  const { error: budgetError } = await supabase.rpc("ai_budget_guard");
  if (budgetError) {
    return Response.json(
      { error: budgetError.message.replace(/^.*?ERROR:\s*/i, "").trim() },
      { status: 429 },
    );
  }

  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) {
    return Response.json({ error: "Ask a question." }, { status: 400 });
  }

  // Step one: which report, and over what period.
  const choice = await generateObject({
    model: MODEL,
    schema: z.object({
      report: z.enum(Object.keys(REPORTS) as [ReportName, ...ReportName[]]),
      days: z.number().int().min(1).max(365).nullable(),
      why: z.string().describe("One short clause on why this report answers it"),
    }),
    prompt: [
      "Choose the report that best answers this question about a warehouse business.",
      "If the question names a period, set days to match it. Otherwise leave it null.",
      "",
      "Reports:",
      ...Object.entries(REPORTS).map(([name, r]) => `- ${name}: ${r.describe}`),
      "",
      `Question: ${question}`,
    ].join("\n"),
  });

  const report = REPORTS[choice.object.report];
  const args = choice.object.days ? { p_days: choice.object.days } : {};

  const { data: rows, error } = await supabase.rpc(report.rpc, args);
  if (error) {
    return Response.json({ error: "Could not run that report." }, { status: 500 });
  }

  const trimmed = (rows ?? []).slice(0, 40);

  // Step two: say what the numbers show. The numbers themselves came from SQL.
  const answer = await generateText({
    model: MODEL,
    prompt: [
      "Answer the question from this report data, for the owner of a Ghanaian warehouse.",
      "",
      "Two or three sentences. Lead with the direct answer. Quote the actual figures,",
      "in Ghana cedis written as GHS 1,234. Do not invent anything that is not here,",
      "and if the data does not answer the question, say so plainly.",
      "",
      `Question: ${question}`,
      `Report: ${choice.object.report}`,
      `Data: ${JSON.stringify(trimmed)}`,
    ].join("\n"),
  });

  const usage = [choice.usage, answer.usage];
  await supabase.rpc("ai_record_usage", {
    p_feature: "report_query",
    p_model: MODEL,
    p_input_tokens: usage.reduce((sum, u) => sum + (u?.inputTokens ?? 0), 0),
    p_output_tokens: usage.reduce((sum, u) => sum + (u?.outputTokens ?? 0), 0),
    p_cost_usd:
      (usage.reduce((sum, u) => sum + (u?.inputTokens ?? 0), 0) / 1_000_000) * 3.0 +
      (usage.reduce((sum, u) => sum + (u?.outputTokens ?? 0), 0) / 1_000_000) * 15.0,
  });

  return Response.json({
    answer: answer.text,
    report: choice.object.report,
    why: choice.object.why,
    rows: trimmed,
  });
}
