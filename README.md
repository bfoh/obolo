# OBOLO

Warehouse stock and valuation for a single company running a wholesale warehouse and a retail shop.

The app exists to answer one question continuously and auditably:

> **What stock is in the warehouse right now, and what is it worth?**

Every movement out of the warehouse — a transfer to the shop, a wholesale sale, a damage write-off, a count adjustment — reduces both quantity and value, and any past valuation can be reconstructed exactly.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Node runtime) |
| Database | Supabase Postgres |
| Styling | Tailwind v4, CSS-first `@theme` |
| AI | Vercel AI SDK v7 via AI Gateway (`anthropic/claude-*`) |
| Tests | Vitest |

## Architecture

All base tables live in a private `core` schema that PostgREST does not serve. `public` contains only:

- **security-definer views** (`public.v_*`) which mask cost columns behind `is_owner()`
- **RPCs** which perform every write

There is no third path to the data. Cost columns are not protected by remembering to revoke them one at a time — they are unreachable because the schema they live in is not exposed.

```
Next.js  ──reads──►  public.v_*  ──►  core.*
         ──writes─►  public.post_*(…)  ──►  core.*
```

### The ledger

Three layers, described in full in `supabase/migrations/`:

| Layer | Table | Mutability |
|---|---|---|
| Event | `core.stock_movements` | append-only, signed `qty_delta` + `value_delta` |
| FIFO detail | `core.movement_batch_allocations` | append-only, one row per batch touched |
| Position | `core.stock_batches`, `core.stock_levels` | derived, written only by trigger |

Costing is **FIFO by batch**, allocated in SQL inside one transaction under a per-(product, location) advisory lock. Nothing is ever updated or deleted; a mistake is undone by posting a reversal that returns units to the exact batches they came from at the exact cost they left at.

### Roles

| Role | Sees cost | Manages the team | Notes |
|---|---|---|---|
| `owner` | yes | anyone | The business owner. Only an owner may create, promote to, demote or suspend another owner. |
| `admin` | yes | everyone except owners | Every right an owner has, minus the line above. |
| `warehouse_staff` | no | no | Warehouse floor: receives, dispatches transfers, sells wholesale. |
| `retail_staff` | no | no | Shop floor: receives transfers, sells retail, takes returns. |

Staff never see cost, margin, or stock value anywhere in the app. Roles resolve from `core.app_users` rather than JWT claims, so a demotion takes effect on the next statement instead of the next token refresh — and a suspension withdraws access to every view on the same statement, not just to the app's own gates.

**An admin is an owner for every authorization decision**, and that is implemented in exactly one place. `public.current_user_role()` returns an *effective* role, mapping a stored `admin` to `owner`; `is_owner()`, `core.can_post()`, `core.require_owner()` and every `v_*` view's cost mask all read through it, so none of them mention `admin` at all. The stored role is still available — `public.current_user_account_role()` and `public.is_account_owner()` — and is used for two things only: showing the right label on the team screen, and enforcing the one asymmetry above.

`src/lib/permissions.ts` mirrors this for the UI: `can()` collapses `admin` onto `owner` rather than carrying its own column in the matrix, so the two cannot drift apart one capability at a time. Use `hasFullAccess()` to gate a screen; `isOwner()` is narrower and is only for deciding who may touch an owner account.

#### The system administrator

A standing break-glass `admin` account, so whoever maintains the deployment can look at a problem without borrowing the owner's password.

```bash
npm run admin:create                              # uses OBOLO_SYSTEM_ADMIN_EMAIL
npm run admin:create -- ops@example.com "Ops"     # or name it directly
npm run admin:create -- --reset-password          # rotate it
```

No password is stored in this repository. If `OBOLO_SYSTEM_ADMIN_PASSWORD` is unset the script generates one, prints it once, and writes it nowhere — a default admin password committed to a repo is a way in, not a maintenance tool. The role is assigned by `public.provision_system_admin()`, which is granted to `service_role` alone; that grant *is* its authorization, which is why it may take an email where nothing else in this codebase may.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase keys
npm run dev
```

### Database

Migrations are managed by the Supabase CLI and applied in timestamp order.

```bash
supabase link --project-ref xhipmlagwmybyiqxdzrz
npm run db:push       # apply migrations to the linked project
npm run db:reset      # rebuild a local database from scratch (needs Docker)
npm run db:lint
```

### Verifying the ledger

```bash
npm run db:verify
```

Applies every migration to a throwaway Postgres, **twice** (proving idempotency), then exercises the ledger end to end: FIFO draws oldest-first, transfers preserve per-batch cost and are value-neutral, short receipts leave a visible residual in transit, overselling is refused, the ledger rejects UPDATE and DELETE, reversals restore quantity and value exactly, the three-way integrity check agrees, and every cost column reads `null` for staff.

This runs on a real Postgres binary shipped inside `node_modules` (`embedded-postgres`), so it needs no Docker and no system install. It is the gate that matters: a valuation bug is the one failure this app cannot ship, and the logic lives in SQL where unit tests cannot reach it.

It is not a substitute for `supabase db reset` — it shims the parts of a Supabase database that migrations assume (the `auth` schema, the client roles, the `extensions` schema) rather than being one.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |
| `npm run admin:create` | Provision the break-glass system administrator |

## Conventions

- **Money arithmetic never happens in TypeScript.** Postgres returns `numeric` as a string to preserve precision; a float64 cannot hold the `numeric(18,6)` range exactly, so any client-side total would disagree with the ledger. All summing and allocation is SQL. The client formats only.
- **A masked cost is `null`, not `0`.** `isMasked()` in `src/lib/format.ts` distinguishes them; rendering a masked value as `₵0.00` claims the stock is worthless.
- **Every SECURITY DEFINER function derives identity from `auth.uid()`**, never from an argument. A function that accepts a user id lets any caller pass someone else's.
- **Pure logic lives in `src/lib/*.ts` with a colocated `.test.ts`.**

## The AI layer

Four features, all through the Vercel AI Gateway with `anthropic/*` model
strings. One rule runs through all of them: **the model never writes.**

| | |
|---|---|
| `/assistant` | Asks and answers. Read tools run through the same masked views as the rest of the app; write tools return a proposal a person confirms. |
| `/receive` → photograph | Reads a delivery note. Lands in `needs_review`; every line must be matched and priced by a human before it becomes a draft delivery. |
| `/insights` | Written overnight by a scheduled job from SQL-computed numbers. The model chooses what is worth saying, not what the numbers are. |
| `/reports` | Ask in plain words. The model picks one of five fixed reports and its period — it never writes SQL. |

Two things make that safe rather than merely stated:

- **Reads go through the caller's own session.** A staff member's assistant
  cannot report a cost, because the view returns null to it exactly as it does
  everywhere else.
- **Writes carry the proposal's id as the idempotency token**, so confirming
  the same suggestion twice — a double tap, a retried request — posts once.

Spend is recorded per call in `core.ai_usage` and checked before every request,
because a cap that cannot be measured is a wish.

### Scheduling

`vercel.json` runs `/api/insights` nightly at 04:00 UTC. It authenticates with
`CRON_SECRET` rather than a session, since it runs with no user.

```bash
curl -X POST "$URL/api/insights" -H "Authorization: Bearer $CRON_SECRET"
```
