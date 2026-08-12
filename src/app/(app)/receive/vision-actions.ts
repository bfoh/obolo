"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface PostExtractionResult {
  error: string | null;
  receiptId?: string;
}

/**
 * Turns the lines a person confirmed into a draft delivery.
 *
 * Only what they ticked, matched and priced arrives here. The extraction itself
 * is never posted — it is a suggestion that a human converted into a document,
 * and the document still has to be posted separately.
 */
export async function postExtraction(
  documentId: string,
  lines: { product_id: string; qty: number; unit_cost: number }[],
  waybillNo: string | null,
): Promise<PostExtractionResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("ai_document_to_receipt", {
    p_document_id: documentId,
    p_lines: lines,
    p_waybill_no: waybillNo,
  });

  if (error) {
    return { error: error.message.replace(/^.*?ERROR:\s*/i, "").trim() || "Could not build it." };
  }

  revalidatePath("/receive");
  return { error: null, receiptId: data as string };
}
