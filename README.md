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

`owner`, `warehouse_staff`, `retail_staff`. Staff never see cost, margin, or stock value anywhere in the app. Roles resolve from `core.app_users` rather than JWT claims, so a demotion takes effect on the next statement instead of the next token refresh.

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

Local development against a real Postgres needs Docker or OrbStack installed, for `supabase start`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest, once |
| `npm run test:watch` | Vitest, watching |

## Conventions

- **Money arithmetic never happens in TypeScript.** Postgres returns `numeric` as a string to preserve precision; a float64 cannot hold the `numeric(18,6)` range exactly, so any client-side total would disagree with the ledger. All summing and allocation is SQL. The client formats only.
- **A masked cost is `null`, not `0`.** `isMasked()` in `src/lib/format.ts` distinguishes them; rendering a masked value as `₵0.00` claims the stock is worthless.
- **Every SECURITY DEFINER function derives identity from `auth.uid()`**, never from an argument. A function that accepts a user id lets any caller pass someone else's.
- **Pure logic lives in `src/lib/*.ts` with a colocated `.test.ts`.**
