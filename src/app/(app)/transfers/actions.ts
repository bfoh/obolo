"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error: string | null;
}

/**
 * Postgres raises with a message written for the person who will read it --
 * "insufficient stock: short by 12 of 150 units" -- so it is surfaced rather
 * than replaced. The Supabase error envelope wraps it in noise, which is not.
 */
function readable(message: string): string {
  const cleaned = message.replace(/^.*?ERROR:\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

export async function createTransfer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const from = String(formData.get("from_location_id") ?? "");
  const to = String(formData.get("to_location_id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!from || !to) return { error: "Choose where the stock is going from and to." };
  if (from === to) return { error: "A transfer needs two different locations." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_transfer", {
    p_from_location_id: from,
    p_to_location_id: to,
    p_notes: notes,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/transfers");
  redirect(`/transfers/${data as string}`);
}

export async function setTransferLine(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const transferId = String(formData.get("transfer_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const qty = Number(formData.get("qty"));

  if (!productId) return { error: "Pick a product." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many are going." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_transfer_line", {
    p_transfer_id: transferId,
    p_product_id: productId,
    p_qty: qty,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/transfers/${transferId}`);
  return { error: null };
}

export async function removeTransferLine(formData: FormData): Promise<void> {
  const transferId = String(formData.get("transfer_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");

  const supabase = await createClient();
  // Zero quantity is how the RPC expresses "remove this line".
  await supabase.rpc("set_transfer_line", {
    p_transfer_id: transferId,
    p_product_id: productId,
    p_qty: 0,
  });

  revalidatePath(`/transfers/${transferId}`);
}

export async function dispatchTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const transferId = String(formData.get("transfer_id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_transfer_dispatch", {
    p_transfer_id: transferId,
    // A retried submit on a bad connection must not dispatch the stock twice.
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null };
}

export async function receiveTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const transferId = String(formData.get("transfer_id") ?? "");

  // Each line arrives as qty__<lineId>, so a partial receipt is expressible:
  // whatever is not entered stays in transit rather than being assumed.
  const received: { line_id: string; qty: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty__")) continue;
    const qty = Number(value);
    if (Number.isFinite(qty) && qty > 0) {
      received.push({ line_id: key.slice("qty__".length), qty });
    }
  }

  if (received.length === 0) {
    return { error: "Enter what actually arrived before confirming." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_transfer_receive", {
    p_transfer_id: transferId,
    p_received: received,
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null };
}

export async function cancelTransfer(formData: FormData): Promise<void> {
  const transferId = String(formData.get("transfer_id") ?? "");
  const supabase = await createClient();
  await supabase.rpc("cancel_transfer", { p_transfer_id: transferId });
  revalidatePath("/transfers");
  redirect("/transfers");
}
