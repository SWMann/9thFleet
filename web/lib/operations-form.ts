/**
 * The words and choices of the operations pages, shared by the pages, the
 * forms and the actions. The types match the database's own.
 */

export type EventState = "draft" | "announced" | "done" | "cancelled";
export type WeaponsState = "hold" | "tight" | "free";
export type Reply = "attending" | "not_attending";
export type Returned = "present" | "absent_with_notice" | "absent_without_notice";

export const stateNames: Record<EventState, string> = {
  draft: "Draft",
  announced: "Announced",
  done: "Done",
  cancelled: "Cancelled",
};

export const weapons: { key: WeaponsState; name: string; meaning: string }[] = [
  { key: "hold", name: "Weapons hold", meaning: "Self-defence only" },
  { key: "tight", name: "Weapons tight", meaning: "Identified hostiles only" },
  { key: "free", name: "Weapons free", meaning: "Free to engage" },
];
export const weaponsName = (state: WeaponsState) => weapons.find((entry) => entry.key === state)?.name ?? state;

export const returnedNames: Record<Returned, string> = {
  present: "Present",
  absent_with_notice: "Absent, with notice",
  absent_without_notice: "Absent, without notice",
};

/**
 * The five sections of an operation order and what each holds, from Volume 2.
 * A type of event can give a section its own name and its own guidance. These
 * are what a section is called when its type does not.
 */
export const paragraphs = [
  { key: "situation", name: "1 Situation", holds: "Hostile forces and reports, friendly forces and the area.", max: 4000 },
  { key: "mission", name: "2 Mission", holds: "One sentence: who, what, where, when, and in order to do what.", max: 1000 },
  {
    key: "execution",
    name: "3 Execution",
    holds:
      "The commander's intent, the phases, a task for each unit, timings, the weapons state, and actions on contact, casualty and disconnect.",
    max: 4000,
  },
  {
    key: "support",
    name: "4 Support",
    holds: "Ships, fuel and rearming, the medical chain, the reinforcement point and the fallback ship.",
    max: 4000,
  },
  {
    key: "command_and_signal",
    name: "5 Command and signal",
    holds: "The commander and second-in-command, succession, nets, callsigns and codewords.",
    max: 4000,
  },
] as const;
export type ParagraphKey = (typeof paragraphs)[number]["key"];

/** One section of an event's orders, as its type names it. */
export type Section = { key: ParagraphKey; name: string; holds: string; max: number };

/** The five sections, each with a type's own name and guidance where it has them. */
export function sectionsFrom(own: (key: ParagraphKey, part: "name" | "holds") => string | null | undefined): Section[] {
  return paragraphs.map((paragraph) => ({
    key: paragraph.key,
    max: paragraph.max,
    name: own(paragraph.key, "name") || paragraph.name,
    holds: own(paragraph.key, "holds") || paragraph.holds,
  }));
}

/**
 * A type of event. The types are records the Fleet Commander keeps under
 * Structure, so the site reads them from the database and never lists them itself.
 */
export type EventType = {
  /** What an event holds to say which type it is. */
  key: string;
  name: string;
  /** Who usually runs one, and an example. Shown to whoever drafts it. */
  runBy: string;
  example: string;
  /** Command drafts every type. This one is open to instructors too. */
  instructorsMayDraft: boolean;
  /** What a new event of this type starts with. */
  defaultDuration: number;
  defaultWeaponsState: WeaponsState | null;
  sections: Section[];
};

/** How every event runs, from the roadmap. */
export const cycle: { step: string; detail: string }[] = [
  { step: "Warning order", detail: "At least 72 hours out: the task and the time." },
  { step: "Roll", detail: "You confirm against your own post. The roll closes 24 hours out, and the commander fills the gaps." },
  { step: "Muster", detail: "15 minutes before: attendance, uniform and loadout, and a radio check on every net." },
  { step: "Orders", detail: "Situation, mission, execution, support, command and signal." },
  { step: "Execution", detail: "Under the comms plan." },
  { step: "Hot debrief", detail: "10 minutes: the plan, what happened, why, what to keep and what to change." },
  { step: "After-action report", detail: "Filed within 48 hours. Lessons become changes to procedure." },
];

const inUtc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });

/** A moment as the fleet writes it: the day and the time in UTC, and the time in the UK beside it. */
export function formatWhen(iso: string): { day: string; utc: string; uk: string } {
  const at = new Date(iso);
  return {
    day: inUtc({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(at),
    utc: `${inUtc({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)} UTC`,
    uk: `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).format(at)} UK`,
  };
}

/** The date and time fields of the event form, in UTC, from a stored moment. */
export function toFields(iso: string): { date: string; time: string } {
  const text = new Date(iso).toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The same time of the week as a moment, the first one after now. For a copy of an event. */
export function aWeekOn(iso: string, now: number): string {
  let at = Date.parse(iso) + WEEK;
  while (at <= now) at += WEEK;
  return new Date(at).toISOString();
}

/**
 * The title of the event that follows this one: a number at its end goes up by
 * one, so Patrol 001 is followed by Patrol 002. The database does the same when
 * it drafts next week's event.
 */
export function nextTitle(title: string): string {
  const found = /[0-9]{1,9}$/.exec(title);
  if (!found) return title;
  const following = String(Number(found[0]) + 1).padStart(found[0].length, "0");
  const next = title.slice(0, found.index) + following;
  return next.length > 80 ? title : next;
}
