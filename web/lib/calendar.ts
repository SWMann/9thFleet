/**
 * Calendar files: the words a calendar app reads. Nothing here reads the
 * database.
 */

/** Text as a calendar file writes it. */
export const escaped = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A moment as a calendar file writes it, in UTC: 20270206T190000Z. */
export const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** A line is at most 75 bytes. A longer one carries on, on a line that starts with a space. */
export function folded(line: string): string {
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

export type CalendarEvent = {
  id: string;
  title: string;
  kindName: string;
  startsAt: string;
  durationMinutes: number;
  musterAt: string;
  state: "announced" | "done" | "cancelled";
  /** When the event's record last changed, so a calendar app knows to take the new version. */
  updatedAt?: string;
  /** The reader's own reply, if any. */
  reply?: "attending" | "not_attending" | null;
};

const replyWords = { attending: "You are attending.", not_attending: "You are not attending." } as const;

/** One event as the lines of a VEVENT. */
export function eventLines(event: CalendarEvent, origin: string, now: Date): string[] {
  const link = `${origin}/operations/${event.id}`;
  const starts = new Date(event.startsAt);
  const ends = new Date(starts.getTime() + event.durationMinutes * 60_000);
  const reply = event.reply ? ` ${replyWords[event.reply]}` : "";
  return [
    "BEGIN:VEVENT",
    `UID:${event.id}@${new URL(origin).host}`,
    `DTSTAMP:${stamp(now)}`,
    `SEQUENCE:${event.updatedAt ? Math.floor(Date.parse(event.updatedAt) / 1000) % 1_000_000_000 : 0}`,
    `DTSTART:${stamp(starts)}`,
    `DTEND:${stamp(ends)}`,
    `SUMMARY:${escaped(event.state === "cancelled" ? `Cancelled: ${event.title}` : event.title)}`,
    `DESCRIPTION:${escaped(`${event.kindName}.${reply} The orders and the roll are on the fleet's site: ${link}`)}`,
    event.musterAt ? `LOCATION:${escaped(event.musterAt)}` : null,
    `URL:${link}`,
    `STATUS:${event.state === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
  ].filter((line): line is string => line !== null);
}

/** A whole calendar, folded and ended the way the format asks. */
export function calendarFile(name: string, events: CalendarEvent[], origin: string, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UEE 9th Fleet//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escaped(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((event) => eventLines(event, origin, now)),
    "END:VCALENDAR",
  ];
  return `${lines.map(folded).join("\r\n")}\r\n`;
}

/** A feed key as the database makes one: 64 hex characters. */
export const FEED_KEY = /^[0-9a-f]{64}$/;

/** The address of a member's feed, from their key. */
export const feedAddress = (origin: string, key: string) => `${origin}/calendar/${key}.ics`;
