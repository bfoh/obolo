"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export interface ConfirmState {
  error: string | null;
  done?: string | null;
}

/**
 * Carries out something the assistant proposed.
 *
 * The model never reaches this. It produced a description; a person read it and
 * pressed a button, and only that press gets here. The proposal is recorded
 * first so its id can be used as the idempotency token on the posting RPC --
 * which means confirming the same suggestion twice, whether by a double tap or
 * a retried request, posts exactly once.
 *
 * Every path below calls the same RPC the equivalent screen would call, so the
 * role checks, credit limits, count freezes and stock rules all apply
 * identically. Nothing here is a shortcut around them.
 */
export async function confirmProposal(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  const toolName = String(formData.get("tool") ?? "");
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(String(formData.get("input") ?? "{}"));
  } catch {
    return { error: "That suggestion could not be read." };
  }

  const supabase = await createClient();

  const { data: proposalId, error: proposeError } = await supabase.rpc("ai_propose_tool_call", {
    p_tool_name: toolName,
    p_input: input,
  });
  if (proposeError || !proposalId) {
    return { error: "Could not record that suggestion." };
  }

  const fail = async (message: string): Promise<ConfirmState> => {
    await supabase.rpc("ai_resolve_tool_call", {
      p_id: proposalId,
      p_status: "failed",
      p_error: message,
    });
    return { error: message };
  };

  const readable = (message: string) =>
    message.replace(/^.*?ERROR:\s*/i, "").trim() || "That did not work.";

  // Resolve the product or customer the person actually meant, by the same
  // search the assistant used. A name that matches nothing stops here rather
  // than posting against a guess.
  async function findProduct(name: string): Promise<{ id: string; label: string } | null> {
    const { data } = await supabase
      .from("v_products")
      .select("id,name,sku")
      .or(`name.ilike.%${String(name).replace(/[,()]/g, " ")}%,sku.ilike.%${name}%`)
      .eq("is_active", true)
      .limit(2);
    if (!data || data.length !== 1) return null;
    return { id: data[0].id as string, label: data[0].name as string };
  }

  try {
    if (toolName === "record_write_off") {
      if (!can(user.role, "writeOff")) return await fail("You cannot write off stock.");

      const product = await findProduct(String(input.product ?? ""));
      if (!product) {
        return await fail(`No single product matches "${input.product}". Do it from the stock screen.`);
      }

      const { error } = await supabase.rpc("write_off_stock", {
        p_product_id: product.id,
        p_location_id: user.locationIds[0],
        p_qty: Number(input.qty),
        p_reason: String(input.reason ?? ""),
        p_expired: Boolean(input.expired),
        // The proposal's own id, so confirming twice posts once.
        p_client_token: proposalId,
      });
      if (error) return await fail(readable(error.message));

      await supabase.rpc("ai_resolve_tool_call", { p_id: proposalId, p_status: "executed" });
      revalidatePath("/", "layout");
      return { error: null, done: `Wrote off ${input.qty} of ${product.label}.` };
    }

    if (toolName === "record_payment") {
      if (!can(user.role, "customers")) return await fail("You cannot record payments.");

      const { data: matches } = await supabase
        .from("v_customers")
        .select("id,name")
        .ilike("name", `%${String(input.customer ?? "").replace(/[,()]/g, " ")}%`)
        .limit(2);

      if (!matches || matches.length !== 1) {
        return await fail(`No single customer matches "${input.customer}".`);
      }

      const { error } = await supabase.rpc("record_payment", {
        p_customer_id: matches[0].id,
        p_amount: Number(input.amount),
        p_method: String(input.method ?? "cash"),
        p_client_token: proposalId,
      });
      if (error) return await fail(readable(error.message));

      await supabase.rpc("ai_resolve_tool_call", { p_id: proposalId, p_status: "executed" });
      revalidatePath("/", "layout");
      return { error: null, done: `Recorded GHS ${input.amount} from ${matches[0].name}.` };
    }

    // A transfer is a document, not a single movement, so the assistant only
    // opens it — the picking list and dispatch stay on the transfers screen
    // where quantities can be checked against what is actually on the pallet.
    if (toolName === "start_transfer") {
      if (!can(user.role, "transferDispatch")) return await fail("You cannot send stock.");

      const product = await findProduct(String(input.product ?? ""));
      if (!product) return await fail(`No single product matches "${input.product}".`);

      const { data: locations } = await supabase.from("v_locations").select("id,kind");
      const from = locations?.find((l) => l.kind === "warehouse")?.id;
      const to = locations?.find((l) => l.kind === "retail")?.id;
      if (!from || !to) return await fail("Could not work out where to send it from.");

      const { data: transferId, error } = await supabase.rpc("create_transfer", {
        p_from_location_id: from,
        p_to_location_id: to,
        p_notes: "Started by the assistant",
      });
      if (error) return await fail(readable(error.message));

      await supabase.rpc("set_transfer_line", {
        p_transfer_id: transferId,
        p_product_id: product.id,
        p_qty: Number(input.qty),
      });

      await supabase.rpc("ai_resolve_tool_call", { p_id: proposalId, p_status: "executed" });
      revalidatePath("/transfers");
      return {
        error: null,
        done: `Started a transfer of ${input.qty} ${product.label}. Open Transfers to dispatch it.`,
      };
    }

    return await fail("That is not something the assistant can do.");
  } catch (error) {
    return await fail(error instanceof Error ? error.message : "That did not work.");
  }
}
