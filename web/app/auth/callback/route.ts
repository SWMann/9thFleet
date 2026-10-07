import { NextResponse, type NextRequest } from "next/server";
import { originOf } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Discord sends the visitor back here with a one-time code. Swapping the code
 * for a session signs them in. The session is kept in cookies.
 */
export async function GET(request: NextRequest) {
  const origin = originOf(request.headers, request.nextUrl.origin);
  const params = request.nextUrl.searchParams;

  if (params.has("error")) {
    return NextResponse.redirect(`${origin}/sign-in?problem=cancelled`);
  }

  const code = params.get("code");
  const supabase = code ? await createClient() : null;
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/profile`);
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?problem=callback`);
}
