/**
 * Provisions the break-glass system administrator.
 *
 * A standing account for whoever maintains the deployment, so a problem can be
 * looked at without borrowing the owner's password. It holds every right an
 * owner does except one: it cannot create, promote to, demote or suspend an
 * owner. That asymmetry is enforced in SQL, not here.
 *
 *   node scripts/create-system-admin.mjs
 *   node scripts/create-system-admin.mjs sysadmin@example.com "Systems Admin"
 *   node scripts/create-system-admin.mjs --reset-password
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local,
 * and the account's identity from OBOLO_SYSTEM_ADMIN_EMAIL /
 * OBOLO_SYSTEM_ADMIN_NAME (in .env.local or the environment) unless given as
 * arguments.
 *
 * NO PASSWORD IS STORED IN THIS REPOSITORY. If OBOLO_SYSTEM_ADMIN_PASSWORD is
 * not set, one is generated, printed once, and never written anywhere. A
 * default admin account with a default password is not a maintenance tool, it
 * is a way in -- so this refuses to invent a memorable one.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESET_PASSWORD = process.argv.includes("--reset-password");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function loadEnv() {
  let env = {};
  try {
    const raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  } catch {
    // No .env.local: fall back to the ambient environment, which is how this
    // runs in CI or from a deploy shell.
  }
  return { ...env, ...stripUndefined(process.env) };
}

function stripUndefined(source) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined));
}

/** 24 random bytes, base64url. Long enough that nobody is tempted to reuse it. */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

async function main() {
  const env = await loadEnv();

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
    );
  }

  const email = (args[0] ?? env.OBOLO_SYSTEM_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const fullName = (args[1] ?? env.OBOLO_SYSTEM_ADMIN_NAME ?? "Systems Administrator").trim();
  if (!email) {
    throw new Error(
      "No address. Pass one as an argument or set OBOLO_SYSTEM_ADMIN_EMAIL in .env.local.",
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- 1. the Auth account -------------------------------------------------
  const wanted = env.OBOLO_SYSTEM_ADMIN_PASSWORD || generatePassword();
  let password = wanted;
  let created = true;

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password: wanted,
    email_confirm: true,
  });

  if (createError) {
    const existing = await findUser(admin, email);
    if (!existing) throw new Error(`could not create the account: ${createError.message}`);
    created = false;

    if (RESET_PASSWORD) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password: wanted });
      if (error) throw new Error(`could not reset the password: ${error.message}`);
    } else {
      password = null; // left as it was; printing a guess would be a lie
    }
  }

  // --- 2. the role ---------------------------------------------------------
  // provision_system_admin() is granted to service_role alone, which is what
  // authorises this call. It refuses to demote an owner.
  const { error: roleError } = await admin.rpc("provision_system_admin", {
    p_email: email,
    p_full_name: fullName,
  });
  if (roleError) throw new Error(`could not assign the admin role: ${roleError.message}`);

  // --- 3. say what happened, once -----------------------------------------
  console.log(`\n${created ? "Created" : "Updated"} the system administrator.\n`);
  console.log(`  Name      ${fullName}`);
  console.log(`  Email     ${email}`);
  console.log(`  Role      admin — every right an owner has, except touching an owner account`);
  if (password) {
    console.log(`  Password  ${password}`);
    console.log(
      `\nThis is the only time the password is shown. Put it in a password manager now.`,
    );
  } else {
    console.log(`  Password  unchanged — re-run with --reset-password to set a new one`);
  }
  console.log("");
}

/** listUsers is paginated, and the account may not be on the first page. */
async function findUser(admin, email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`could not list accounts: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

main().catch((error) => {
  console.error("\n" + error.message);
  process.exit(1);
});
