/**
 * Routine orders: their words, and how the site drafts an issue from the
 * fleet's record. Nothing here reads the database.
 *
 * An issue is formatted text. The site writes the record of the period since
 * the last issue into it, section by section, with a free section at the top
 * for command's own words, and command edits the whole thing before issuing.
 */

import type { HostileKind } from "@/lib/hostile-form";
import type { Status } from "@/lib/member";

export type OrderState = "draft" | "issued";

/** How often an issue is expected, in days. Volume 2 has them weekly from stage 2. */
export const EVERY_DAYS = 7;
/** The most an issue holds, counting its formatting. */
export const BODY_LIMIT = 12000;
/** The most lines a section of the draft lists before it says how many more there were. */
export const SECTION_LIMIT = 30;

export type Named = { id: string; name: string };

export type OrderParts = {
  /** The period the issue records, in UTC. */
  period: { from: string; to: string };
  /** A post taken up, at the rank it was taken up at, or left. */
  appointments: { member: Named; post: string; unit: string; rank: string | null; acting: boolean; on: string; what: "appointed" | "left" }[];
  /** A change of grade: up, down, made acting, or confirmed in the grade after acting. */
  grades: { member: Named; rank: string; grade: string; acting: boolean; on: string; what: "promoted" | "stepped down" | "acting" | "confirmed" }[];
  qualifications: { member: Named; qualification: string; on: string }[];
  /** A change of status: recruit, auxiliary, member, reserve or discharged. */
  statuses: { member: Named; status: Status; on: string }[];
  /** Held in the period. `attended` is null until the attendance return is made. */
  held: { title: string; type: string; startsAt: string; attended: number | null; href: string }[];
  ahead: { title: string; type: string; startsAt: string; href: string }[];
  /** Names declared hostile or placed on watch. A lifted entry is for command, and is not published. */
  hostiles: { handle: string; kind: HostileKind; what: "hostile" | "watch"; on: string }[];
  strength: { serving: number; members: number; auxiliaries: number; recruits: number; reserve: number; stage: number };
};

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** A day as the fleet writes it: 14 October 2026. */
export const dayOf = (date: string) => dayFormat.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date));
/** When an event starts, with the time written as a Zulu time, which readers see in their own time. */
export const whenOf = (date: string) => `${weekdayFormat.format(new Date(date))}, ${timeFormat.format(new Date(date)).replace(":", "")}Z`;

/** The name of an issue. */
export const orderName = (number: number) => `Routine Orders ${number}`;

/** Words written into formatted text as words: nothing in them is read as formatting or a link, and they stay on one line. */
export const words = (text: string) => text.replace(/\s+/g, " ").replace(/[\\`*_[\]<>~#]/g, (mark) => `\\${mark}`);
/** A member named in formatted text, the way the editor names one. */
export const mention = (member: Named) => `[@${words(member.name)}](member:${member.id})`;

const statusWords: Record<Status, string> = {
  applicant: "applied to join",
  recruit: "joined the fleet as a recruit",
  auxiliary: "became an auxiliary",
  member: "became a full member",
  reserve: "moved to the reserve",
  discharged: "left the fleet",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A list, cut at `limit` lines with a line saying how many more there were, and `none` when it is empty. */
function listed(lines: string[], limit: number, none: string, more: string): string {
  if (lines.length === 0) return none;
  const shown = lines.length > limit ? lines.slice(0, limit) : lines;
  const rest = lines.length - shown.length;
  return `${shown.map((line) => `- ${line}`).join("\n")}${rest > 0 ? `\n- And ${plural(rest, "more", "more")}, ${more}.` : ""}`;
}
const section = (title: string, body: string) => `## ${title}\n\n${body}`;

/**
 * The draft of an issue: command's own sections first, then the record of the
 * period, section by section. A section with nothing in it says so, so that
 * command can delete it or leave it. A section lists `limit` lines at most,
 * and fewer when the whole draft would otherwise be too long to save.
 */
export function composeRoutineOrders(parts: OrderParts, limit = SECTION_LIMIT): string {
  const { period, strength } = parts;
  const sections = [
    `## From the Fleet Commander\n\n*Write here, or delete this section.*`,
    `## Decisions\n\n*Decisions of command and the board since the last issue, or delete this section.*`,
    `## Standing orders\n\nNo change.`,
    section(
      "Appointments",
      listed(
        parts.appointments.map((entry) =>
          entry.what === "appointed"
            ? `${mention(entry.member)} appointed ${words(entry.post)}, ${words(entry.unit)}${entry.rank ? `, as ${entry.acting ? "acting " : ""}${words(entry.rank)}` : entry.acting ? ", acting" : ""}, from ${dayOf(entry.on)}.`
            : `${mention(entry.member)} left ${words(entry.post)}, ${words(entry.unit)}, on ${dayOf(entry.on)}.`,
        ),
        limit,
        "None.",
        "in the order of battle",
      ),
    ),
    section(
      "Promotions",
      listed(
        parts.grades.map((entry) =>
          entry.what === "promoted"
            ? `${mention(entry.member)} promoted to ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
            : entry.what === "acting"
              ? `${mention(entry.member)} acting ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
              : entry.what === "confirmed"
                ? `${mention(entry.member)} confirmed as ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
                : `${mention(entry.member)} now ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`,
        ),
        limit,
        "None.",
        "on the service records",
      ),
    ),
    section(
      "Qualifications",
      listed(
        parts.qualifications.map((entry) => `${mention(entry.member)} awarded ${words(entry.qualification)}, ${dayOf(entry.on)}.`),
        limit,
        "None.",
        "on the service records",
      ),
    ),
    section(
      "Joined and left",
      listed(
        parts.statuses.map((entry) => `${mention(entry.member)} ${statusWords[entry.status]}, ${dayOf(entry.on)}.`),
        limit,
        "Nobody.",
        "on the roll",
      ),
    ),
    `## Operations\n\n${
      parts.held.length > 0
        ? `Held since the last issue:\n\n${listed(
            parts.held.map(
              (event) =>
                `[${words(event.title)}](${event.href}), ${words(event.type)}, ${dayOf(event.startsAt)}: ${event.attended === null ? "attendance return to come" : plural(event.attended, "attended", "attended")}.`,
            ),
            limit,
            "",
            "on the operations page",
          )}`
        : "Nothing held since the last issue."
    }\n\n${
      parts.ahead.length > 0
        ? `Ahead:\n\n${listed(
            parts.ahead.map((event) => `[${words(event.title)}](${event.href}), ${words(event.type)}, ${whenOf(event.startsAt)}.`),
            limit,
            "",
            "on the operations page",
          )}`
        : "Nothing announced for the fortnight ahead."
    }`,
    section(
      "Hostile list",
      listed(
        parts.hostiles.map(
          (entry) =>
            `${entry.kind === "organisation" ? "The organisation " : ""}${words(entry.handle)} ${entry.what === "watch" ? "placed on watch" : "declared hostile"}, ${dayOf(entry.on)}.`,
        ),
        limit,
        "No change.",
        "on the hostile list",
      ),
    ),
    `## Strength\n\n${plural(strength.serving, "serving", "serving")}: ${plural(strength.members, "full member", "full members")}, ${plural(strength.auxiliaries, "auxiliary", "auxiliaries")}, ${plural(strength.recruits, "recruit", "recruits")} and ${plural(strength.reserve, "reservist", "reservists")}. Stage ${strength.stage}.`,
    `## Notices\n\n*Anything else, or delete this section.*`,
  ];
  const draft = `*This issue records ${dayOf(period.from)} to ${dayOf(period.to)}.*\n\n${sections.join("\n\n")}`;
  // Too long to save: list fewer lines in each section, down to a handful.
  return draft.length > BODY_LIMIT && limit > 3 ? composeRoutineOrders(parts, Math.max(3, Math.floor(limit / 2))) : draft;
}

/** The title and words of an issue from a form, or what is wrong with them. `get` reads one field as tidy text. */
export function readOrders(get: (name: string) => string): { fields: { title: string; body: string } } | { problem: string } {
  const title = get("title").replace(/\s+/g, " ").trim();
  if (title.length > 80) return { problem: "Keep the title under 80 characters." };
  const body = get("body").trim();
  if (body.length > BODY_LIMIT) return { problem: `Keep the orders to ${BODY_LIMIT.toLocaleString("en-GB")} characters, counting their formatting.` };
  return { fields: { title, body } };
}

/** How long since the last issue, in whole days, and whether the next is due. */
export function sinceIssue(lastIssuedAt: string | null, now: number): { days: number | null; due: boolean } {
  if (!lastIssuedAt) return { days: null, due: false };
  const days = Math.floor((now - Date.parse(lastIssuedAt)) / (24 * 60 * 60 * 1000));
  return { days, due: days >= EVERY_DAYS };
}
