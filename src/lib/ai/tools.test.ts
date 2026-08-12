import { describe, expect, it } from "vitest";
import { buildTools, isWriteTool, WRITE_TOOLS, type ToolContext } from "./tools";
import type { Role } from "@/lib/permissions";

const ctx = (role: Role | null): ToolContext => ({
  role: role as Role,
  locationId: "loc-1",
  read: async () => [] as never,
  select: async () => [] as never,
});

const namesFor = (role: Role | null) => Object.keys(buildTools(ctx(role)));

describe("buildTools", () => {
  it("gives the owner everything", () => {
    const names = namesFor("owner");
    expect(names).toContain("warehouse_value");
    expect(names).toContain("who_owes_us");
    expect(names).toContain("record_write_off");
    expect(names).toContain("start_transfer");
    expect(names).toContain("record_payment");
  });

  // A tool the caller may not use must be ABSENT, not refused at execution.
  // The model cannot offer, mention, or attempt what it was never handed.
  it("never hands a staff role the tool that reports value", () => {
    for (const role of ["warehouse_staff", "retail_staff"] as Role[]) {
      expect(namesFor(role)).not.toContain("warehouse_value");
    }
  });

  it("keeps the customer ledger away from the shop floor", () => {
    expect(namesFor("warehouse_staff")).toContain("who_owes_us");
    expect(namesFor("retail_staff")).not.toContain("who_owes_us");
    expect(namesFor("retail_staff")).not.toContain("record_payment");
  });

  it("only offers dispatch to the side that dispatches", () => {
    expect(namesFor("warehouse_staff")).toContain("start_transfer");
    expect(namesFor("retail_staff")).not.toContain("start_transfer");
  });

  it("fails closed for an unresolved role", () => {
    const names = namesFor(null);
    expect(names).not.toContain("warehouse_value");
    expect(names).not.toContain("record_write_off");
    expect(names).not.toContain("record_payment");
    expect(names).not.toContain("start_transfer");
    // Left with only the reads that need no capability at all.
    expect(names.sort()).toEqual(["expiring_soon", "low_stock", "stock_on_hand"]);
  });

  it("gives every role something to answer with", () => {
    for (const role of ["owner", "warehouse_staff", "retail_staff"] as Role[]) {
      expect(namesFor(role)).toContain("stock_on_hand");
    }
  });
});

describe("write tools", () => {
  // The whole safety model: these return a description, never a result.
  it("names every tool that must be confirmed by a person", () => {
    expect(WRITE_TOOLS).toEqual(["record_write_off", "start_transfer", "record_payment"]);
  });

  it("recognises a write tool by name", () => {
    expect(isWriteTool("record_write_off")).toBe(true);
    expect(isWriteTool("stock_on_hand")).toBe(false);
  });

  it("returns a proposal rather than doing the thing", async () => {
    const tools = buildTools(ctx("owner")) as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >;

    const result = (await tools.record_write_off.execute(
      { product: "rice", qty: 3, reason: "water damage" },
      {},
    )) as { proposal: boolean; tool: string; summary: string };

    expect(result.proposal).toBe(true);
    expect(result.tool).toBe("record_write_off");
    expect(result.summary).toContain("3");
    expect(result.summary).toContain("rice");
  });
});
