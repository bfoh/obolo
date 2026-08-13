import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SideRail } from "@/components/shell/SideRail";
import { BottomNav } from "@/components/shell/BottomNav";

async function getCompanyName(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("company_name");
  return typeof data === "string" && data.length > 0 ? data : "OBOLO";
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Fetched together, not one after the other. The company name does not depend
  // on the user, but it used to be awaited after them, so it added a whole
  // round trip to the critical path of every page -- and because a layout's
  // awaits resolve before its children render, every page's own queries waited
  // behind it. getCompanyName swallows its errors and falls back, so running it
  // for a caller who turns out to be signed out costs nothing.
  const [user, companyName] = await Promise.all([getCurrentUser(), getCompanyName()]);

  // proxy.ts already bounces anonymous requests, but a signed-in auth user with
  // no active app_users row reaches here. They have an account and no access,
  // which is a different state and must not fall through to the app.
  if (!user) {
    redirect("/login");
  }

  // Someone still on a password an owner typed for them gets exactly one
  // destination. /password sits outside this route group on purpose, so this
  // redirect cannot loop into itself and there is no pathname to special-case.
  if (user.mustChangePassword) {
    redirect("/password");
  }

  return (
    <div className="flex min-h-dvh bg-surface">
      <SideRail role={user.role} fullName={user.fullName} companyName={companyName} />

      {/* pb-nav clears the fixed mobile bar; md:pb-0 drops it once the rail takes over. */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">{children}</div>

      <BottomNav role={user.role} />
    </div>
  );
}
