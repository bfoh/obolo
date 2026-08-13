import { generateObject } from "ai";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasFullAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

// Handwriting and creased carbon copies are hard. This is the job to spend a
// bigger model on -- a misread quantity becomes a wrong valuation.
const MODEL = "anthropic/claude-sonnet-5";

const Extraction = z.object({
  supplier: z.string().nullable().describe("Supplier name if printed on the document"),
  document_number: z.string().nullable().describe("Waybill or invoice number"),
  lines: z.array(
    z.object({
      description: z.string().describe("The product exactly as written"),
      quantity: z.number().nullable(),
      unit: z.string().nullable().describe("Bag, carton, piece — as written"),
      unit_cost: z.number().nullable().describe("Price per unit if shown"),
      confident: z
        .boolean()
        .describe("False if any part of this line was a guess, smudged or ambiguous"),
    }),
  ),
  notes: z.string().nullable().describe("Anything unclear a human should check"),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  // Reading costs off a photograph is an owner's job -- the whole point is that
  // the numbers land in the valuation.
  if (!user || !hasFullAccess(user.role)) {
    return Response.json({ error: "Only an owner can read a delivery note." }, { status: 403 });
  }

  const supabase = await createClient();

  const { error: budgetError } = await supabase.rpc("ai_budget_guard");
  if (budgetError) {
    return Response.json(
      { error: budgetError.message.replace(/^.*?ERROR:\s*/i, "").trim() },
      { status: 429 },
    );
  }

  const form = await req.formData();
  const file = form.get("image");
  const docType = String(form.get("doc_type") ?? "delivery_note");

  if (!(file instanceof File)) {
    return Response.json({ error: "No photo was sent." }, { status: 400 });
  }
  if (file.size > 8_000_000) {
    return Response.json({ error: "That photo is too large. Try again closer in." }, { status: 400 });
  }

  const { data: documentId } = await supabase.rpc("ai_create_document", {
    p_doc_type: docType,
  });

  try {
    const bytes = await file.arrayBuffer();

    const result = await generateObject({
      model: MODEL,
      schema: Extraction,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "This is a photograph of a delivery document from a Ghanaian warehouse.",
                "Read every line item exactly as written. Do not tidy up product names,",
                "do not convert units, and do not calculate anything that is not printed.",
                "",
                "If a digit is unclear, mark that line as not confident rather than guessing.",
                "A wrong quantity here becomes a wrong stock valuation, so an honest",
                "'unsure' is far more useful than a confident mistake.",
                "",
                "Amounts are Ghana cedis. Leave a field null if it is not on the document.",
              ].join("\n"),
            },
            { type: "image", image: bytes, mediaType: file.type || "image/jpeg" },
          ],
        },
      ],
    });

    await supabase.rpc("ai_record_usage", {
      p_feature: "vision",
      p_model: MODEL,
      p_input_tokens: result.usage?.inputTokens ?? 0,
      p_output_tokens: result.usage?.outputTokens ?? 0,
      // Sonnet pricing, as a local estimate for the budget guard.
      p_cost_usd:
        ((result.usage?.inputTokens ?? 0) / 1_000_000) * 3.0 +
        ((result.usage?.outputTokens ?? 0) / 1_000_000) * 15.0,
    });

    // Lands for review. Nothing read off a photograph enters the ledger unseen.
    await supabase.rpc("ai_save_extraction", {
      p_id: documentId,
      p_extracted: result.object,
      p_model: MODEL,
    });

    return Response.json({ id: documentId, ...result.object });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that photo.";
    await supabase.rpc("ai_fail_document", { p_id: documentId, p_error: message.slice(0, 500) });
    return Response.json({ error: "Could not read that photo. Try a clearer one." }, { status: 502 });
  }
}
