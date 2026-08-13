import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. Same execution model.
 *
 * Its only jobs here are refreshing the Supabase session cookie and bouncing
 * signed-out visitors away from app routes. It is deliberately NOT the
 * authorization layer: proxy runs before the request reaches any data, and a
 * redirect is only a convenience. Real enforcement is in Postgres -- RLS on
 * `core`, `is_owner()` masking in the `public.v_*` views, and role checks
 * inside the posting RPCs -- so a request that slips past this file still
 * cannot read cost or move stock.
 */
const PUBLIC_ROUTES = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes authenticate themselves -- some by session, the scheduled ones
  // by a shared secret because they run with no user at all. Redirecting them
  // to an HTML login page is a nonsense reply to a machine, and it silently
  // turns "unauthorised" into "200 OK with a login form".
  //
  // Returned BEFORE the client is built, because getUser() below is a network
  // call to Supabase. This check used to sit after it, so every API request --
  // including the nightly cron -- paid a full auth round trip and then threw
  // the answer away.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase. getSession() only decodes
  // the cookie, which a client can forge, so it must not be used for this.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Send them back where they were headed once signed in.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. Excluding these
    // matters: running an auth round-trip per image request is pure latency.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
