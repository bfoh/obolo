/**
 * Applies pending migrations to a remote Postgres over a direct connection.
 *
 *   DATABASE_URL='postgresql://...' node scripts/push-migrations.mjs [--dry-run]
 *
 * `supabase db push` is the normal tool for this and should be preferred once
 * the CLI is linked. This exists for the case where the CLI cannot see the
 * project (wrong account, no access token) but a database connection string is
 * available.
 *
 * It records applied migrations in `supabase_migrations.schema_migrations`,
 * the same table and version format the Supabase CLI uses, so the two stay
 * interchangeable -- push here now, `supabase db push` later, without either
 * re-running work the other already did.
 *
 * Each migration runs inside its own transaction: a failure rolls that file
 * back whole rather than leaving the schema half-built.
 */
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    // Supabase terminates TLS at the pooler with a cert this client does not
    // have the chain for. The connection is still encrypted.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected.");

  try {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
    `);

    const { rows } = await client.query(
      "select version from supabase_migrations.schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !applied.has(f.split("_")[0]));

    if (pending.length === 0) {
      console.log(`Nothing pending. ${applied.size} migration(s) already applied.`);
      return;
    }

    console.log(`${applied.size} applied, ${pending.length} pending:`);
    for (const file of pending) console.log(`  - ${file}`);

    if (DRY_RUN) {
      console.log("\nDry run; nothing was applied.");
      return;
    }

    console.log("");
    for (const file of pending) {
      const version = file.split("_")[0];
      const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
      const sql = await readFile(path.join(MIGRATIONS, file), "utf8");

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)
           on conflict (version) do nothing`,
          [version, name, [sql]],
        );
        await client.query("commit");
        console.log(`  ok    ${file}`);
      } catch (error) {
        await client.query("rollback");
        console.error(`  FAIL  ${file}`);
        console.error(`        ${error.message}`);
        if (error.hint) console.error(`        hint: ${error.hint}`);
        if (error.detail) console.error(`        detail: ${error.detail}`);
        throw error;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n" + error.message);
  process.exit(1);
});
