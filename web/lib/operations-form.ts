/**
 * The words and choices of the operations pages, shared by the pages, the
 * forms and the actions. The types match the database's own.
 */

export type EventKind = "training" | "patrol" | "response" | "strike" | "tasked_pve";
export type EventState = "draft" | "announced" | "done" | "cancelled";
export type WeaponsState = "hold" | "tight" | "free";
export type Reply = "attending" | "not_attending";
export type Returned = "present" | "absent_with_notice" | "absent_without_notice";

/** The operation types, who runs each and an example, from the roadmap. */
export const kinds: { key: EventKind; name: string; runBy: string; example: string }[] = [
  {
    key: "training",
    name: "Training evolution",
    runBy: "Training team",
    example: "Ship emergency drills, turret gunnery, launch and recovery",
  },
  { key: "patrol", name: "Patrol", runBy: "Duty commander", example: "Presence patrol of a Stanton sector, reporting contacts" },
  { key: "response", name: "Response", runBy: "Duty commander", example: "Answering a piracy report from the public request line" },
  {
    key: "strike",
    name: "Strike",
    runBy: "Command",
    example: "Planned action against a declared hostile org or a known pirate spot",
  },
  { key: "tasked_pve", name: "Tasked PvE", runBy: "Duty commander", example: "In-game contracts given a tasking, when no hostile shows" },
];
export const kindName = (kind: EventKind) => kinds.find((entry) => entry.key === kind)?.name ?? kind;

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

/** The five paragraphs of an operation order and what each holds, from Volume 2. */
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
