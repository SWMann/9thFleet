/**
 * The words and choices of the operations pages, shared by the pages, the
 * forms and the actions. The types match the database's own.
 */

export type EventState = "draft" | "announced" | "done" | "cancelled";
/** Where a draft stands with command: nobody has asked, someone has, or command has approved it. */
export type Approval = "not_asked" | "asked" | "approved";
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

export const serviceNames = { navy: "Navy", army: "Army", marines: "Marines" } as const;

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
  /** A draft of this type by someone who is not command waits for command's approval. */
  needsApproval: boolean;
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

export type Outcome = "achieved" | "partly" | "not_achieved";
export const outcomeNames: Record<Outcome, string> = {
  achieved: "Achieved",
  partly: "Partly achieved",
  not_achieved: "Not achieved",
};

/**
 * The parts of an event that are lists of records. Five are its plan:
 * objectives, the elements and their tasks, the timeline, the ships and the
 * nets. Two belong to its after-action report: losses and mentions. One editor
 * draws each from its list of fields, and one pair of actions saves them. To
 * let another column be written, add a field here. The database's own rules
 * still decide who may write.
 */
export type PlanField = {
  key: string;
  label: string;
  /**
   * A time is entered as the time of day in UTC, and kept as minutes before or after the start.
   * A member is chosen from a list the page provides, and is set once.
   */
  kind: "text" | "long" | "time" | "number" | "member";
  /** For a long text that sits in a line of the page: bold, italic and links, and nothing that makes a block. */
  line?: boolean;
  /** The longest a text can be, or the largest a number can be. */
  max: number;
  required?: boolean;
  hint?: string;
};

export type PlanPartKey = "objectives" | "elements" | "timings" | "ships" | "nets" | "losses" | "mentions";

export type PlanPart = {
  key: PlanPartKey;
  table: "event_objectives" | "event_elements" | "event_timings" | "event_ships" | "event_nets" | "event_losses" | "event_mentions";
  /** Written with the report, by whoever ran the event, and not with the plan. */
  report?: boolean;
  /** What one record is called, and the heading over them all. */
  one: string;
  many: string;
  about: string;
  /** The field a record is known by in its list. */
  titled: string;
  fields: PlanField[];
  /** Whether records keep the order they were added in. The timeline is in order of time instead. */
  ordered: boolean;
};

export const planParts: PlanPart[] = [
  {
    key: "objectives",
    table: "event_objectives",
    one: "objective",
    many: "Objectives",
    about: "What the event sets out to do, one to a line. The after-action report answers each in turn.",
    titled: "title",
    ordered: true,
    fields: [{ key: "title", label: "Objective", kind: "text", max: 200, required: true, hint: "Such as: hold the lane between ArcCorp and microTech for one hour." }],
  },
  {
    key: "elements",
    table: "event_elements",
    one: "element",
    many: "Other elements",
    about: "A team put together for the night that is not a unit of the order of battle, with its task and the callsign it answers to. Everyone reads its task.",
    titled: "name",
    ordered: true,
    fields: [
      { key: "name", label: "Element", kind: "text", max: 80, required: true, hint: "Such as a boarding team or a safety boat." },
      { key: "callsign", label: "Callsign", kind: "text", max: 40 },
      { key: "task", label: "Task", kind: "long", max: 1000, hint: "What it is to do, and in order to do what." },
    ],
  },
  {
    key: "timings",
    table: "event_timings",
    one: "timing",
    many: "Timeline",
    about: "What happens when. Each time is kept against the start, so the timeline moves with the event.",
    titled: "label",
    ordered: false,
    fields: [
      { key: "time", label: "Time, in UTC", kind: "time", max: 5, required: true, hint: "Up to twelve hours before or after the start." },
      { key: "label", label: "What happens", kind: "text", max: 120, required: true, hint: "Such as Muster, Orders, Step off or Hot debrief." },
    ],
  },
  {
    key: "ships",
    table: "event_ships",
    one: "ship",
    many: "Ships",
    about: "The ships and vehicles the event uses.",
    titled: "ship",
    ordered: true,
    fields: [
      { key: "ship", label: "Ship", kind: "text", max: 80, required: true, hint: "Such as Hammerhead, or UEES Nexus (Polaris)." },
      { key: "note", label: "Note", kind: "text", max: 200, hint: "What it is for, who brings it, or where it starts." },
    ],
  },
  {
    key: "nets",
    table: "event_nets",
    one: "net",
    many: "Comms plan",
    about: "The nets for the night: what each is for and who controls it. Callsigns are set with the elements above.",
    titled: "name",
    ordered: true,
    fields: [
      { key: "name", label: "Net", kind: "text", max: 60, required: true },
      { key: "purpose", label: "What it is for", kind: "text", max: 200 },
      { key: "controller", label: "Who controls it", kind: "text", max: 80, hint: "A callsign or a name." },
    ],
  },
  {
    key: "losses",
    table: "event_losses",
    report: true,
    one: "loss",
    many: "Losses",
    about: "What the event cost: ships, vehicles, cargo. The fleet reads this with the report.",
    titled: "item",
    ordered: false,
    fields: [
      { key: "item", label: "What was lost", kind: "text", max: 120, required: true, hint: "Such as Gladius, or cargo." },
      { key: "quantity", label: "How many", kind: "number", max: 999, required: true },
      { key: "note", label: "Note", kind: "text", max: 200, hint: "How it was lost, in a few words." },
    ],
  },
  {
    key: "mentions",
    table: "event_mentions",
    report: true,
    one: "mention",
    many: "Mentions",
    about: "A member named for something they did. It is shown with the report and on the member's own record, to the serving fleet.",
    titled: "member_name",
    ordered: false,
    fields: [
      { key: "member_id", label: "Member", kind: "member", max: 36, required: true },
      { key: "citation", label: "For what", kind: "long", line: true, max: 300, required: true, hint: "One or two sentences on what they did." },
    ],
  },
];

export const planPartOf = (key: string) => planParts.find((part) => part.key === key) ?? null;

/** A moment so many minutes before or after another. */
export function offsetFrom(startIso: string, minutes: number): string {
  return new Date(Date.parse(startIso) + minutes * 60_000).toISOString();
}

/**
 * How many minutes before or after the start a time of day is, taking the
 * occurrence of that time nearest the start. "18:45" against a 19:00 start is -15.
 */
export function minutesFromStart(startIso: string, time: string): number | null {
  const found = /^(\d{2}):(\d{2})$/.exec(time);
  if (!found) return null;
  const start = new Date(startIso);
  const startOfDay = start.getUTCHours() * 60 + start.getUTCMinutes();
  let offset = Number(found[1]) * 60 + Number(found[2]) - startOfDay;
  if (Number(found[1]) > 23 || Number(found[2]) > 59) return null;
  if (offset < -720) offset += 1440;
  if (offset >= 720) offset -= 1440;
  return offset;
}

/** A timing against the start, as orders write it: H-15, H, H+90. */
export function hLabel(minutes: number): string {
  return minutes === 0 ? "H" : minutes < 0 ? `H-${-minutes}` : `H+${minutes}`;
}
