"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function dismissInsight(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("ai_dismiss_insight", { p_id: id });
  revalidatePath("/insights");
}
