import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { sessionCookieOptions } from "./cookies";
import { supabaseEnv } from "./env";

/**
 * A database client that acts as whoever is signed in on this request.
 * It keeps the session in cookies. Returns null if no database is connected.
 */
export async function createClient() {
  // Wait for a real request first, even with no database connected. Whatever
  // calls this belongs to one person at one moment, so it must never be built
  // in advance and served to everyone. The session check also reads the clock,
  // which is only allowed once a request has arrived.
  await connection();
  const cookieStore = await cookies();
  if (!supabaseEnv) return null;
  const secure = (await headers()).get("x-forwarded-proto") === "https";

  return createServerClient(supabaseEnv.url, supabaseEnv.key, {
    cookieOptions: sessionCookieOptions(secure),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A page cannot write cookies while it renders. That is fine: the
          // proxy refreshes the session before the page runs.
        }
      },
    },
  });
}
