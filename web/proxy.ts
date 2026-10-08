import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only the pages that use a session. The public pages stay static.
export const config = {
  matcher: [
    "/profile/:path*",
    "/order-of-battle/:path*",
    "/operations/:path*",
    "/apply/:path*",
    "/staff/:path*",
    "/sign-in",
    "/auth/:path*",
  ],
};
