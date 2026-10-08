import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { countedPath } from "@/lib/visits";

/** Robots that say what they are. They are not readers, so they are not counted. */
const ROBOTS = /bot\b|bot\/|crawl|spider|slurp|preview|monitor|headless|lighthouse|pingdom|uptime|python|curl|wget/i;

/**
 * Count one view of a public page.
 *
 * It keeps nothing about who read the page. The request's address, browser and
 * cookies are not read or stored: the count is always made as a visitor, so it
 * does not touch a member's session either. The database adds one to that
 * page's total for the day and keeps no row of its own.
 */
export async function POST(request: NextRequest) {
  const done = new Response(null, { status: 204 });
  if (!supabaseEnv) return done;
  if (ROBOTS.test(request.headers.get("user-agent") ?? "")) return done;
  // Only this site's own pages count a view.
  const from = request.headers.get("sec-fetch-site");
  if (from && from !== "same-origin") return done;

  let sent: { path?: unknown; landing?: unknown };
  try {
    sent = await request.json();
  } catch {
    return done;
  }
  const path = typeof sent?.path === "string" ? countedPath(sent.path) : null;
  if (!path) return done;

  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await supabase.from("page_view_ticks").insert({ path, landing: sent.landing === true });
  return done;
}
