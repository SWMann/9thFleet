import type { NextRequest } from "next/server";
import { getOperation } from "@/lib/operations";
import { originOf } from "@/lib/origin";

/**
 * One event as a calendar file, for the signed-in member who asked for it.
 *
 * It holds what a calendar needs: the title, the start and end, where to
 * muster, and the address of the event's page. The orders are not in it. It is
 * read through the member's own access, so an event they cannot see is not found.
 */

/** Text as a calendar file writes it. */
const escaped = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** A moment as a calendar file writes it, in UTC: 20270206T190000Z. */
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
/** A line is at most 75 bytes. A longer one carries on, on a line that starts with a space. */
function folded(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 74) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export async function GET(request: NextRequest, context: RouteContext<"/operations/[id]/calendar">) {
  const { id } = await context.params;
  const result = await getOperation(id);
  // Someone not signed in is sent to sign in before this runs. Anyone else it is not for gets the same answer.
  if (result.state !== "ready") return new Response("Not found.", { status: 404 });
  // A draft's date is not settled, so there is nothing to put in a calendar yet.
  if (result.event.state === "draft") return new Response("Not found.", { status: 404 });

  const { event } = result;
  const origin = originOf(request.headers, request.nextUrl.origin);
  const link = `${origin}/operations/${event.id}`;
  const starts = new Date(event.startsAt);
  const ends = new Date(starts.getTime() + event.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UEE 9th Fleet//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@${new URL(origin).host}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(starts)}`,
    `DTEND:${stamp(ends)}`,
    `SUMMARY:${escaped(event.title)}`,
    `DESCRIPTION:${escaped(`${event.kindName}. The orders and the roll are on the fleet's site: ${link}`)}`,
    event.musterAt ? `LOCATION:${escaped(event.musterAt)}` : null,
    `URL:${link}`,
    `STATUS:${event.state === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  const name = event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  return new Response(`${lines.map(folded).join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.ics"`,
      // It is one member's view of one event, so nothing in between keeps a copy.
      "cache-control": "private, no-store",
    },
  });
}
