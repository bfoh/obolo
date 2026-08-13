<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OBOLO

Warehouse stock and valuation. One company, four roles, FIFO batch costing.
See README.md for the architecture.

## Non-negotiables

- **Base tables live in `core`, which PostgREST does not serve.** Never add a
  table to `public`. Reads go through `public.v_*` views (which mask cost via
  `is_owner()`), writes go through `public.post_*` RPCs. There is no third path.
- **Every SECURITY DEFINER function derives identity from `auth.uid()`**, never
  from an argument. A function taking a user id is an IDOR. The two functions
  that take an email (`bootstrap_owner`, `provision_system_admin`) are the
  documented exceptions, and each is safe only because of how it is granted.
- **Authorization asks `public.current_user_role()`, which returns the
  EFFECTIVE role.** A stored `admin` resolves to `owner` there, which is the
  single point where "an admin is an owner" is implemented -- `is_owner()`,
  `core.can_post()` and every view's cost mask inherit it. Never add `'admin'`
  to a role comparison; if you find yourself wanting to, the check is asking the
  wrong function. `current_user_account_role()` and `is_account_owner()` return
  the STORED role and exist only for display and for the one asymmetry: an admin
  may not create, promote to, demote or suspend an owner.
- **Money arithmetic never happens in TypeScript.** Postgres returns `numeric`
  as a string; float64 cannot hold `numeric(18,6)` exactly. All summing,
  allocation and valuation is SQL. The client formats only.
- **A masked cost is `null`, not `0`.** Use `isMasked()` from `src/lib/format.ts`.
- **The stock ledger is append-only.** `core.stock_movements` and
  `core.movement_batch_allocations` are never UPDATEd or DELETEd. Corrections
  are a reversal plus a replacement, carrying a reason.
- **Never add a cost-bearing table to the `supabase_realtime` publication.**
  Realtime respects RLS but ships full row payloads and ignores column grants.

## Conventions

- Pure logic in `src/lib/*.ts` with a colocated `.test.ts`.
- Migrations are CLI-managed in `supabase/migrations/`, timestamp-ordered, and
  must be idempotent — never hand-pasted into the SQL editor.
- Tailwind v4: semantic tokens only (`bg-surface`, `text-ink`, `border-line`).
  Never reach for the raw ramp (`bitumen-900`) outside the shell chrome.
- Numeric data uses the mono face and tabular figures: `className="numeric"`.
