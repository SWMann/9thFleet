import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SIGNED_IN_COOKIE, TIER_COOKIE, sessionCookieOptions, signedInCookieOptions, tierCookieOptions } from "./cookies";
import { supabaseEnv } from "./env";

/**
 * Runs before the member pages. It refreshes the session if it has run out,
 * and sends people to the right place: signed-out visitors away from member
 * pages, and signed-in members past the sign-in page.
 *
 * This is a convenience, not the lock. Each page and action checks the session
 * again, and the database decides what anyone may see.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!supabaseEnv) return response;

  const secure = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")) === "https";

  const supabase = createServerClient(supabaseEnv.url, supabaseEnv.key, {
    cookieOptions: sessionCookieOptions(secure),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // A response that carries a session must never be stored by a cache.
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call, or sessions
  // can be lost at random.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  // Keep the menu's hint in step with the real session.
  const hinted = request.cookies.get(SIGNED_IN_COOKIE)?.value === "1";
  if (signedIn && !hinted) response.cookies.set(SIGNED_IN_COOKIE, "1", signedInCookieOptions(secure));
  if (!signedIn && hinted) response.cookies.delete(SIGNED_IN_COOKIE);

  // The same for the admin pages: which of them the menu offers. The roles are
  // read again when the hint runs out, so a new role shows within ten minutes.
  const tierHint = request.cookies.get(TIER_COOKIE)?.value;
  if (!signedIn && tierHint) response.cookies.delete(TIER_COOKIE);
  if (signedIn && !tierHint) {
    const { data: roles, error } = await supabase.from("member_roles").select("role").eq("member_id", data!.claims.sub);
    if (!error) {
      const held = (roles ?? []).map((row) => row.role as string);
      const tier = ["admin", "command", "staff"].find((role) => held.includes(role)) ?? "none";
      response.cookies.set(TIER_COOKIE, tier, tierCookieOptions(secure));
    }
  }

  const { pathname } = request.nextUrl;
  if (!signedIn && MEMBER_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) {
    return redirectKeepingCookies(request, response, "/sign-in");
  }
  if (signedIn && pathname === "/sign-in") {
    return redirectKeepingCookies(request, response, "/profile");
  }
  return response;
}

/** Pages for signed-in people only. Keep the matcher in proxy.ts in step with this. */
const MEMBER_PAGES = ["/profile", "/order-of-battle", "/operations", "/apply", "/staff", "/admin"];

function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
