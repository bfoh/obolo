import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Role } from "@/lib/permissions";
import { can } from "@/lib/permissions";

/**
 * What the assistant is allowed to do.
 *
 * Two kinds of tool, and the difference is the whole safety model:
 *
 *   READ tools execute immediately. They only return what the caller could
 *   already see, because they run through the same masked views as every other
 *   read -- a staff member's assistant cannot report a cost its user is not
 *   allowed to know.
 *
 *   WRITE tools do not execute at all. They return a proposal for the person to
 *   confirm, and the confirmation is what calls the real posting RPC. The model
 *   cannot move stock, take money, or write off a shortfall on its own.
 *
 * The tool set is filtered by role before the model ever sees it, so a tool the
 * caller may not use is not merely refused -- it is absent, and the model does
 * not offer it in conversation.
 */

export interface ToolContext {
  role: Role;
  locationId: string | null;
  /** Runs a read against the caller's own session. Never a service-role client. */
  read: <T>(fn: string, args: Record<string, unknown>) => Promise<T>;
  select: <T>(view: string, build: (q: never) => unknown) => Promise<T>;
}

/** A write tool returns this instead of doing anything. */
export interface Proposal {
  proposal: true;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
}

function propose(name: string, summary: string, input: Record<string, unknown>): Proposal {
  return { proposal: true, tool: name, summary, input };
}

export function buildTools(ctx: ToolContext): ToolSet {
  const all = {
    // ---- reads -------------------------------------------------------------
    stock_on_hand: tool({
      description:
        "How much of a product is in stock, and where. Use whenever asked how many of something there is.",
      inputSchema: z.object({
        product: z.string().describe("Product name or SKU, as the user said it"),
      }),
      execute: async ({ product }) => ctx.read("ai_stock_lookup", { p_search: product }),
    }),

    low_stock: tool({
      description: "Products at or below their reorder point.",
      inputSchema: z.object({}),
      execute: async () => ctx.read("ai_low_stock", {}),
    }),

    expiring_soon: tool({
      description: "Batches approaching or past their expiry date.",
      inputSchema: z.object({}),
      execute: async () => ctx.read("ai_expiring", {}),
    }),

    warehouse_value: tool({
      description:
        "What the stock is worth, by location. Only available to the owner; do not mention it otherwise.",
      inputSchema: z.object({}),
      execute: async () => ctx.read("valuation_summary", {}),
    }),

    who_owes_us: tool({
      description: "Customers with an outstanding balance, largest first.",
      inputSchema: z.object({}),
      execute: async () => ctx.read("ai_receivables", {}),
    }),

    // ---- writes: proposals only -------------------------------------------
    record_write_off: tool({
      description:
        "Propose writing off stock that is damaged or expired. Always requires the user to confirm.",
      inputSchema: z.object({
        product: z.string(),
        qty: z.number().positive(),
        reason: z.string().describe("What actually happened to it"),
        expired: z.boolean().optional(),
      }),
      execute: async (input) =>
        propose(
          "record_write_off",
          `Write off ${input.qty} of ${input.product} — ${input.reason}`,
          input,
        ),
    }),

    start_transfer: tool({
      description:
        "Propose sending stock from the warehouse to the shop. Always requires the user to confirm.",
      inputSchema: z.object({
        product: z.string(),
        qty: z.number().positive(),
      }),
      execute: async (input) =>
        propose("start_transfer", `Send ${input.qty} of ${input.product} to the shop`, input),
    }),

    record_payment: tool({
      description:
        "Propose recording money received from a customer. Always requires the user to confirm.",
      inputSchema: z.object({
        customer: z.string(),
        amount: z.number().positive(),
        method: z.enum(["cash", "momo", "bank", "cheque"]).optional(),
      }),
      execute: async (input) =>
        propose(
          "record_payment",
          `Record ${input.method ?? "cash"} payment of GHS ${input.amount} from ${input.customer}`,
          input,
        ),
    }),
  };

  // Fail closed: an unknown role reaches this with `can()` returning false for
  // everything, so it is left with the tools that need no capability at all.
  const allowed: ToolSet = {
    stock_on_hand: all.stock_on_hand,
    low_stock: all.low_stock,
    expiring_soon: all.expiring_soon,
  };

  if (can(ctx.role, "cost")) allowed.warehouse_value = all.warehouse_value;
  if (can(ctx.role, "customers")) {
    allowed.who_owes_us = all.who_owes_us;
    allowed.record_payment = all.record_payment;
  }
  if (can(ctx.role, "writeOff")) allowed.record_write_off = all.record_write_off;
  if (can(ctx.role, "transferDispatch")) allowed.start_transfer = all.start_transfer;

  return allowed;
}

export const TOOL_NAMES = [
  "stock_on_hand",
  "low_stock",
  "expiring_soon",
  "warehouse_value",
  "who_owes_us",
  "record_write_off",
  "start_transfer",
  "record_payment",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Write tools, which must never be executed by the model. */
export const WRITE_TOOLS: ToolName[] = ["record_write_off", "start_transfer", "record_payment"];

export function isWriteTool(name: string): name is ToolName {
  return (WRITE_TOOLS as string[]).includes(name);
}
