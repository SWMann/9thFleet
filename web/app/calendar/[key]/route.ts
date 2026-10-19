import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { calendarFile, FEED_KEY, type CalendarEvent } from "@/lib/calendar";
import { originOf } from "@/lib/origin";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * A member's calendar feed: every announced event they can see, with their own
 * reply, as one calendar a calendar app keeps up to date.
 *
 * A calendar app has no session, so the address carries the member's own key,
 * which the database made. The database reads the feed as itself and sends
 * only what the key earns: nothing for a key it does not know, nothing for a
 * key whose owner has left. The site adds nothing to that and keeps no copy.
 */
export async function GET(request: NextRequest, context: RouteContext<"/calendar/[key]">) {
  const { key: asked } = await context.params;
  const key = asked.endsWith(".ics") ? asked.slice(0, -4) : asked;
  if (!FEED_KEY.test(key)) return new Response("Not found.", { status: 404 });
  if (!supabaseEnv) return new Response("This site is not connected to the fleet's database yet.", { status: 503 });

  // Nobody in particular, with the key in a header, which is where the database looks for it.
  const supabase = createClient(supabaseEnv.url, supabaseEnv.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-feed-key": key } },
  });
  const feed = await supabase.from("calendar_feed").select("id, title, kind_name, starts_at, duration_minutes, muster_at, state, updated_at, reply").order("starts_at");
  if (feed.error) return new Response("The feed could not be read.", { status: 503 });

  const events: CalendarEvent[] = (feed.data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    kindName: row.kind_name as string,
    startsAt: row.starts_at as string,
    durationMinutes: Number(row.duration_minutes),
    musterAt: (row.muster_at as string) ?? "",
    state: row.state as CalendarEvent["state"],
    updatedAt: row.updated_at as string,
    reply: (row.reply as CalendarEvent["reply"]) ?? null,
  }));
  const origin = originOf(request.headers, request.nextUrl.origin);
  return new Response(calendarFile("9th Fleet", events, origin), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // One member's feed, read by their own calendar app: nothing in between keeps a copy.
      "cache-control": "private, no-store",
    },
  });
}
