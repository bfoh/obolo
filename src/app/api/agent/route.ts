import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildTools } from "@/lib/ai/tools";

// Node, not edge. Streaming works fine here and the Supabase server client
// wants a full Node runtime.
export const maxDuration = 60;

const MODEL = "anthropic/claude-haiku-4.5";

function systemPrompt(name: string, role: string, company: string) {
  return [
    `You are the assistant inside OBOLO, the stock system for ${company}.`,
    `You are talking to ${name}, whose role is ${role.replace("_", " ")}.`,
    "Amounts are Ghana cedis (GHS). Keep answers to one or two short sentences.",
    "",
    "To answer anything about stock, expiry, what is owed, or what things are worth, CALL A TOOL.",
    "Never guess a quantity, a price, or a total. If no tool can answer it, say so plainly.",
    "",
    "Tools that record something do not record it — they return a proposal that the person",
    "must confirm on screen. So do not say you have done it. Say what you are about to do,",
    "and that it needs confirming.",
    "",
    "If you were not given a tool, that person is not allowed to do it. Do not mention",
    "the tool, do not offer it, and do not explain what they are missing. Simply answer",
    "what you can.",
    "",
    "The user may be speaking, so their words can arrive garbled by speech recognition —",
    "especially numbers. If a quantity looks implausible, ask one short question to confirm",
    "it before proposing anything.",
  ].join("\n");
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Not signed in", { status: 401 });
  }

  const supabase = await createClient();

  // A runaway loop should cost a warning, not a month's rent.
  const { error: budgetError } = await supabase.rpc("ai_budget_guard");
  if (budgetError) {
    return new Response(
      budgetError.message.replace(/^.*?ERROR:\s*/i, "").trim() || "The assistant is unavailable.",
      { status: 429 },
    );
  }

  const { messages, conversationId }: { messages: UIMessage[]; conversationId?: string } =
    await req.json();

  const { data: company } = await supabase.rpc("company_name");

  const read = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      // Hand the model a plain sentence rather than a Postgres error; it has to
      // relay this to a person.
      return { error: "That information is not available to you." } as T;
    }
    return (data ?? []) as T;
  };

  const result = streamText({
    model: MODEL,
    system: systemPrompt(user.fullName, user.role, (company as string) ?? "the company"),
    messages: await convertToModelMessages(messages),
    tools: buildTools({
      role: user.role,
      locationId: user.locationIds[0] ?? null,
      read,
      select: async () => [] as never,
    }),
    // Enough to look something up and answer. Not enough to wander.
    stopWhen: stepCountIs(4),
    onFinish: async ({ usage }) => {
      await supabase.rpc("ai_record_usage", {
        p_feature: "agent",
        p_model: MODEL,
        p_input_tokens: usage?.inputTokens ?? 0,
        p_output_tokens: usage?.outputTokens ?? 0,
        p_cached_tokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
        // Gateway reports spend on its own dashboard; this is a local estimate
        // so the budget guard has something to measure. Haiku pricing.
        p_cost_usd:
          ((usage?.inputTokens ?? 0) / 1_000_000) * 1.0 +
          ((usage?.outputTokens ?? 0) / 1_000_000) * 5.0,
        p_conversation_id: conversationId ?? null,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}
