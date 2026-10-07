import { NextResponse, type NextRequest } from "next/server";
import { originOf } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Start a sign-in: send the visitor to Discord. Discord sends them back to
 * /auth/callback.
 *
 * This is an ordinary form post answered with an ordinary redirect, on purpose.
 * A Server Action that redirects to another site leaves the page's router
 * pointing at that site. In Safari, pressing Back from Discord brings the old
 * page back as it was, and the button then posted to Supabase instead of here
 * and did nothing.
 */
export async function POST(request: NextRequest) {
  const origin = originOf(request.headers, request.nextUrl.origin);

  // Only this site's own sign-in button may start a sign-in.
  const from = request.headers.get("origin");
  if (from && from !== origin) {
    return new NextResponse(null, { status: 403 });
  }

  const supabase = await createClient();
  if (!supabase) return seeOther(`${origin}/sign-in?problem=setup`);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) return seeOther(`${origin}/sign-in?problem=discord`);

  return seeOther(data.url);
}

/** 303 tells the browser to fetch the next page with GET, whatever came before. */
function seeOther(url: string) {
  return NextResponse.redirect(url, 303);
}
