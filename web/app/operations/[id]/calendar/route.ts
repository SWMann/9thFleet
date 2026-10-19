import type { NextRequest } from "next/server";
import { calendarFile } from "@/lib/calendar";
import { getOperation } from "@/lib/operations";
import { originOf } from "@/lib/origin";

/**
 * One event as a calendar file, for the signed-in member who asked for it.
 *
 * It holds what a calendar needs: the title, the start and end, where to
 * muster, and the address of the event's page. The orders are not in it. It is
 * read through the member's own access, so an event they cannot see is not found.
 */
export async function GET(request: NextRequest, context: RouteContext<"/operations/[id]/calendar">) {
  const { id } = await context.params;
  const result = await getOperation(id);
  // Someone not signed in is sent to sign in before this runs. Anyone else it is not for gets the same answer.
  if (result.state !== "ready") return new Response("Not found.", { status: 404 });
  // A draft's date is not settled, so there is nothing to put in a calendar yet.
  if (result.event.state === "draft") return new Response("Not found.", { status: 404 });

  const { event } = result;
  const origin = originOf(request.headers, request.nextUrl.origin);
  const file = calendarFile(
    event.title,
    [
      {
        id: event.id,
        title: event.title,
        kindName: event.kindName,
        startsAt: event.startsAt,
        durationMinutes: event.durationMinutes,
        musterAt: event.musterAt,
        state: event.state === "cancelled" ? "cancelled" : event.state === "done" ? "done" : "announced",
        reply: result.mine.reply,
      },
    ],
    origin,
  );

  const name = event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return new Response(file, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.ics"`,
      // It is one member's view of one event, so nothing in between keeps a copy.
      "cache-control": "private, no-store",
    },
  });
}
