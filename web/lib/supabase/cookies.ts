import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * How the session cookies are kept. HttpOnly means scripts in the page cannot
 * read them, so a fault in the page cannot leak a session. That works because
 * only the server talks to the database on a member's behalf.
 */
export function sessionCookieOptions(secure: boolean): CookieOptionsWithName {
  return { httpOnly: true, secure, sameSite: "lax", path: "/" };
}

/**
 * A second cookie that scripts can read. It holds no secret. It only tells the
 * menu whether to offer "Sign in" or "Your record".
 */
export const SIGNED_IN_COOKIE = "nf_signed_in";

export const signedInCookieOptions = (secure: boolean) =>
  ({ secure, sameSite: "lax", path: "/", maxAge: 400 * 24 * 60 * 60 }) as const;
