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

export type Named = { id: string; name: string };

export type OrderParts = {
  /** The period the issue records, in UTC. */
  period: { from: string; to: string };
  appointments: { member: Named; post: string; unit: string; acting: boolean; on: string; what: "appointed" | "left" }[];
  /** A change of grade: up, down, made acting, or confirmed in the grade after acting. */
  grades: { member: Named; rank: string; grade: string; acting: boolean; on: string; what: "promoted" | "stepped down" | "acting" | "confirmed" }[];
  qualifications: { member: Named; qualification: string; on: string }[];
  /** A change of status: recruit, auxiliary, member, reserve or discharged. */
  statuses: { member: Named; status: Status; on: string }[];
  held: { title: string; type: string; startsAt: string; attended: number; href: string }[];
  ahead: { title: string; type: string; startsAt: string; href: string }[];
  hostiles: { handle: string; kind: HostileKind; what: "hostile" | "watch" | "lifted"; on: string }[];
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

/** Words written into formatted text as words: nothing in them is read as formatting or a link. */
export const words = (text: string) => text.replace(/[\\`*_[\]<>~#]/g, (mark) => `\\${mark}`);
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

const section = (title: string, lines: string[], none: string) => `## ${title}\n\n${lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : none}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The draft of an issue: command's own sections first, then the record of the
 * period, section by section. A section with nothing in it says so, so that
 * command can delete it or leave it.
 */
export function composeRoutineOrders(parts: OrderParts): string {
  const { period, strength } = parts;
  const sections = [
    `## From the Fleet Commander\n\n*Write here, or delete this section.*`,
    `## Decisions\n\n*Decisions of command and the board since the last issue, or delete this section.*`,
    `## Standing orders\n\nNo change.`,
    section(
      "Appointments",
      parts.appointments.map((entry) =>
        entry.what === "appointed"
          ? `${mention(entry.member)} appointed ${words(entry.post)}, ${words(entry.unit)}${entry.acting ? ", acting" : ""}, from ${dayOf(entry.on)}.`
          : `${mention(entry.member)} left ${words(entry.post)}, ${words(entry.unit)}, on ${dayOf(entry.on)}.`,
      ),
      "None.",
    ),
    section(
      "Promotions",
      parts.grades.map((entry) =>
        entry.what === "promoted"
          ? `${mention(entry.member)} promoted to ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
          : entry.what === "acting"
            ? `${mention(entry.member)} acting ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
            : entry.what === "confirmed"
              ? `${mention(entry.member)} confirmed as ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`
              : `${mention(entry.member)} now ${words(entry.rank)} (${entry.grade}) from ${dayOf(entry.on)}.`,
      ),
      "None.",
    ),
    section(
      "Qualifications",
      parts.qualifications.map((entry) => `${mention(entry.member)} awarded ${words(entry.qualification)}, ${dayOf(entry.on)}.`),
      "None.",
    ),
    section(
      "Joined and left",
      parts.statuses.map((entry) => `${mention(entry.member)} ${statusWords[entry.status]}, ${dayOf(entry.on)}.`),
      "Nobody.",
    ),
    `## Operations\n\n${
      parts.held.length > 0
        ? `Held since the last issue:\n\n${parts.held.map((event) => `- [${words(event.title)}](${event.href}), ${words(event.type)}, ${dayOf(event.startsAt)}: ${plural(event.attended, "attended", "attended")}.`).join("\n")}`
        : "Nothing held since the last issue."
    }\n\n${
      parts.ahead.length > 0
        ? `Ahead:\n\n${parts.ahead.map((event) => `- [${words(event.title)}](${event.href}), ${words(event.type)}, ${whenOf(event.startsAt)}.`).join("\n")}`
        : "Nothing announced for the fortnight ahead."
    }`,
    section(
      "Hostile list",
      parts.hostiles.map((entry) => {
        const name = `${entry.kind === "organisation" ? "The organisation " : ""}${words(entry.handle)}`;
        return entry.what === "lifted"
          ? `${name} lifted from the list, ${dayOf(entry.on)}.`
          : `${name} ${entry.what === "watch" ? "placed on watch" : "declared hostile"}, ${dayOf(entry.on)}.`;
      }),
      "No change.",
    ),
    `## Strength\n\n${plural(strength.serving, "serving", "serving")}: ${plural(strength.members, "full member", "full members")}, ${plural(strength.auxiliaries, "auxiliary", "auxiliaries")}, ${plural(strength.recruits, "recruit", "recruits")} and ${plural(strength.reserve, "reservist", "reservists")}. Stage ${strength.stage}.`,
    `## Notices\n\n*Anything else, or delete this section.*`,
  ];
  return `*This issue records ${dayOf(period.from)} to ${dayOf(period.to)}.*\n\n${sections.join("\n\n")}`;
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
