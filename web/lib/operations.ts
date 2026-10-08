import "server-only";
import { getSession, isServing, type Member } from "@/lib/member";
import {
  sectionsFrom,
  type EventState,
  type EventType,
  type ParagraphKey,
  type Reply,
  type Returned,
  type Section,
  type WeaponsState,
} from "@/lib/operations-form";
import { getOrderOfBattle, type Unit } from "@/lib/order-of-battle";
import { createClient } from "@/lib/supabase/server";

/**
 * Events, their orders, the roll and after-action reports, as the signed-in
 * member is allowed to see them. Every row comes through that member's own
 * access: the database's rules decide what is returned and what may change.
 * What this works out about who may do what only chooses which buttons to show.
 */

export type Person = { id: string; name: string; rankName: string | null };

type EventRow = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  starts_at: string;
  duration_minutes: number;
  commander_id: string | null;
  second_id: string | null;
  observer_id: string | null;
  weapons_state: WeaponsState | null;
  pve_fallback: string;
  state: EventState;
  created_by: string | null;
  announced_at: string | null;
  roll_closes_at: string | null;
  copied_from: string | null;
  repeats_weekly: boolean;
};
type AttendanceRow = {
  event_id: string;
  member_id: string;
  reply: Reply | null;
  stand_in_position_id: string | null;
};
type RosterRow = { member_id: string; character_name: string | null; rank_name: string | null; status: string };

const EVENT =
  "id, kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id, weapons_state, pve_fallback, state, created_by, announced_at, roll_closes_at, copied_from, repeats_weekly";
const SERVING = ["recruit", "auxiliary", "member", "reserve"];

export type FleetEvent = {
  id: string;
  /** Its type's key, and what the type is called. */
  kind: string;
  kindName: string;
  title: string;
  summary: string;
  startsAt: string;
  durationMinutes: number;
  commander: Person | null;
  second: Person | null;
  observer: Person | null;
  weaponsState: WeaponsState | null;
  pveFallback: string;
  state: EventState;
  announcedAt: string | null;
  rollClosesAt: string | null;
  /** Whether members can still change their reply. */
  rollOpen: boolean;
  started: boolean;
  /** Closing it, or cancelling it once announced, drafts next week's. */
  repeatsWeekly: boolean;
};

/** One primary post on the night: who holds it, whether they are coming, and who stands in if not. */
export type RollPost = {
  id: string;
  title: string;
  entry: boolean;
  holder: Person | null;
  holderReply: Reply | null;
  /** Its holder is attending, but has been moved to another post for the night. */
  holderMoved: boolean;
  standIn: Person | null;
  /**
   * confirmed: its holder is attending and in it. stand-in: someone fills it for the night.
   * empty: nobody will be in it. waiting: its holder has not replied and the roll is still open.
   */
  state: "confirmed" | "stand-in" | "empty" | "waiting";
};
export type RollGroup = { unit: string; posts: RollPost[] };

export type Roll = {
  groups: RollGroup[];
  posts: number;
  confirmed: number;
  empty: number;
  waiting: number;
  /** Attending with no post on the night: the people a stand-in usually comes from. */
  spare: Person[];
  /** Attending in their own post. Whoever runs the event can move one up for the night. */
  inPost: Person[];
  notAttending: Person[];
};

export type Summary = FleetEvent & { myReply: Reply | null; posts: number; confirmed: number };

type Outside =
  | { state: "no-database" }
  | { state: "signed-out" }
  | { state: "no-record" }
  /** Signed in, but not serving. Events are for the serving fleet. */
  | { state: "outside" };

export type Operations =
  | Outside
  | { state: "ready"; member: Member; mayCreate: EventType[]; drafts: Summary[]; coming: Summary[]; past: Summary[] };

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
type TypeRow = Record<string, unknown>;

/** The types of event, in the order the Fleet Commander has put them. */
export async function readEventTypes(supabase: Client): Promise<EventType[]> {
  const { data, error } = await supabase.from("event_types").select("*").order("sort_order", { ascending: true });
  if (error) throw new Error(`The event types could not be read: ${error.message}`);
  return ((data ?? []) as TypeRow[]).map(
    (row): EventType => ({
      key: row.key as string,
      name: row.name as string,
      runBy: (row.run_by as string) ?? "",
      example: (row.example as string) ?? "",
      instructorsMayDraft: row.instructors_may_draft === true,
      defaultDuration: Number(row.default_duration_minutes ?? 120),
      defaultWeaponsState: (row.default_weapons_state as WeaponsState | null) ?? null,
      sections: sectionsFrom((key, part) => row[`${key}_${part}`] as string | null),
    }),
  );
}

/** The types this member may draft: any as command, and as an instructor the ones open to instructors. */
export function typesFor(member: Member, types: EventType[]): EventType[] {
  if (!isServing(member)) return [];
  if (member.roles.includes("command") || member.roles.includes("admin")) return types;
  return member.roles.includes("instructor") ? types.filter((type) => type.instructorsMayDraft) : [];
}

const isCommand = (member: Member) =>
  isServing(member) && (member.roles.includes("command") || member.roles.includes("admin"));

function nameOf(row: RosterRow | undefined, id: string | null): Person | null {
  if (!id) return null;
  return { id, name: row?.character_name ?? "A member with no name set", rankName: row?.rank_name ?? null };
}

/** The open primary posts, grouped by the unit they sit in, in the order of battle's own order. */
function openPosts(fleet: Unit) {
  const groups: { unit: string; posts: Unit["posts"] }[] = [];
  const walk = (unit: Unit, above: string | null) => {
    const posts = unit.posts.filter((post) => post.kind === "primary" && post.open);
    // A department is named with its ship: "UEES Nexus, Gunnery".
    const name = unit.kind === "department" && above ? `${above}, ${unit.name}` : unit.name;
    if (posts.length > 0) groups.push({ unit: name, posts });
    for (const child of unit.units) walk(child, unit.name);
  };
  walk(fleet, null);
  return groups;
}

function toEvent(row: EventRow, people: Map<string, RosterRow>, types: EventType[], now: number): FleetEvent {
  const person = (id: string | null) => nameOf(id ? people.get(id) : undefined, id);
  return {
    id: row.id,
    kind: row.kind,
    kindName: types.find((type) => type.key === row.kind)?.name ?? row.kind,
    title: row.title,
    summary: row.summary,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    commander: person(row.commander_id),
    second: person(row.second_id),
    observer: person(row.observer_id),
    weaponsState: row.weapons_state,
    pveFallback: row.pve_fallback,
    state: row.state,
    announcedAt: row.announced_at,
    rollClosesAt: row.roll_closes_at,
    rollOpen: row.state === "announced" && row.roll_closes_at !== null && now < Date.parse(row.roll_closes_at),
    started: now >= Date.parse(row.starts_at),
    repeatsWeekly: row.repeats_weekly === true,
  };
}

function buildRoll(
  event: FleetEvent,
  groups: ReturnType<typeof openPosts>,
  lines: AttendanceRow[],
  people: Map<string, RosterRow>,
): Roll {
  const byMember = new Map(lines.map((line) => [line.member_id, line]));
  const standIns = new Map<string, string>();
  for (const line of lines) if (line.stand_in_position_id) standIns.set(line.stand_in_position_id, line.member_id);

  const placed = new Set<string>();
  const roll: Roll = { groups: [], posts: 0, confirmed: 0, empty: 0, waiting: 0, spare: [], inPost: [], notAttending: [] };
  for (const group of groups) {
    const posts = group.posts.map((post): RollPost => {
      const held = post.holders[0];
      const holder = held ? { id: held.memberId, name: held.name ?? "A member with no name set", rankName: held.rankName } : null;
      const holderReply = holder ? (byMember.get(holder.id)?.reply ?? null) : null;
      const standInId = standIns.get(post.id) ?? null;
      const standIn = nameOf(standInId ? people.get(standInId) : undefined, standInId);
      if (holder) placed.add(holder.id);
      if (standIn) placed.add(standIn.id);

      const holderMoved = holder !== null && holderReply === "attending" && byMember.get(holder.id)?.stand_in_position_id != null;
      const state =
        holderReply === "attending" && !holderMoved
          ? "confirmed"
          : standIn
            ? "stand-in"
            : holder && holderReply === null && event.rollOpen
              ? "waiting"
              : "empty";
      if (holder && state === "confirmed") roll.inPost.push(holder);
      roll.posts += 1;
      if (state === "confirmed" || state === "stand-in") roll.confirmed += 1;
      else roll[state] += 1;
      return { id: post.id, title: post.title, entry: post.entry, holder, holderReply, holderMoved, standIn, state };
    });
    roll.groups.push({ unit: group.unit, posts });
  }

  for (const line of lines) {
    const person = nameOf(people.get(line.member_id), line.member_id);
    if (!person) continue;
    if (line.reply === "attending" && !placed.has(line.member_id)) roll.spare.push(person);
    if (line.reply === "not_attending") roll.notAttending.push(person);
  }
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  roll.spare.sort(byName);
  roll.inPost.sort(byName);
  roll.notAttending.sort(byName);
  return roll;
}

/** What the pages need before anything else: the member, and that they serve. */
async function serving(): Promise<Outside | { state: "ready"; member: Member }> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  // Events are for the serving fleet. The database returns none to anyone else.
  if (!isServing(session.member)) return { state: "outside" };
  return { state: "ready", member: session.member };
}

/** Every event the member may see, sorted into drafts, what is coming and what has been. */
export async function getOperations(): Promise<Operations> {
  const who = await serving();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [events, roster, battle, types] = await Promise.all([
    supabase.from("events").select(EVENT).order("starts_at", { ascending: true }),
    supabase.from("roster").select("member_id, character_name, rank_name, status"),
    getOrderOfBattle(),
    readEventTypes(supabase),
  ]);
  for (const result of [events, roster]) {
    if (result.error) throw new Error(`The events could not be read: ${result.error.message}`);
  }
  const rows = (events.data ?? []) as EventRow[];
  const lines =
    rows.length > 0
      ? await supabase
          .from("attendance")
          .select("event_id, member_id, reply, stand_in_position_id")
          .in(
            "event_id",
            rows.map((row) => row.id),
          )
      : { data: [] as AttendanceRow[], error: null };
  if (lines.error) throw new Error(`The roll could not be read: ${lines.error.message}`);

  const people = new Map(((roster.data ?? []) as RosterRow[]).map((row) => [row.member_id, row]));
  const groups = battle.state === "ready" ? openPosts(battle.fleet) : [];
  const now = Date.now();

  const summaries = rows.map((row): Summary => {
    const event = toEvent(row, people, types, now);
    const mine = ((lines.data ?? []) as AttendanceRow[]).filter((line) => line.event_id === row.id);
    const roll = buildRoll(event, groups, mine, people);
    return {
      ...event,
      myReply: mine.find((line) => line.member_id === who.member.id)?.reply ?? null,
      posts: roll.posts,
      confirmed: roll.confirmed,
    };
  });

  return {
    state: "ready",
    member: who.member,
    mayCreate: typesFor(who.member, types),
    drafts: summaries.filter((event) => event.state === "draft"),
    coming: summaries.filter((event) => event.state === "announced"),
    // The latest first.
    past: summaries.filter((event) => event.state === "done" || event.state === "cancelled").reverse(),
  };
}

export type Orders = { warning_order: string } & Record<ParagraphKey, string>;

export type ReturnLine = { person: Person; reply: Reply | null; returned: Returned | null };

export type Operation =
  | Outside
  | { state: "not-found" }
  | {
      state: "ready";
      member: Member;
      event: FleetEvent;
      orders: Orders;
      /** The five sections of the orders, as this event's type names them. */
      sections: Section[];
      /** The event this one was copied from, if the member can still read it. */
      copiedFrom: { id: string; title: string } | null;
      roll: Roll;
      /** The member's own line on the roll. */
      mine: { reply: Reply | null; standInFor: string | null; holdsAPost: boolean };
      /** Who runs it: its commander, its second-in-command, or command. */
      runs: boolean;
      /** Who may write its orders: whoever runs it, and its author while it is a draft. */
      edits: boolean;
      /**
       * For whoever runs the event: everyone to mark on the attendance return. That is who replied,
       * holders of open posts who did not, and anyone already marked. Empty for everyone else.
       */
      returns: ReturnLine[];
      /** What the member's own line of the return says, once it is made. Nobody else's is shown to them. */
      myReturn: Returned | null;
      report: { whatHappened: string; toKeep: string; toChange: string; author: Person | null; filedAt: string } | null;
      /** Serving members, for choosing a commander. Only read for someone who may edit the event. */
      people: Person[];
      /** The types this member may draft. */
      mayCreate: EventType[];
      /** Every type, so an event keeps its own on the list when someone else changes it. */
      types: EventType[];
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One event with its orders, its roll and its report. */
export async function getOperation(id: string): Promise<Operation> {
  const who = await serving();
  if (who.state !== "ready") return who;
  if (!UUID.test(id)) return { state: "not-found" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const { member } = who;

  const [found, orders, lines, marks, report, roster, battle, types] = await Promise.all([
    supabase.from("events").select(EVENT).eq("id", id).maybeSingle(),
    supabase
      .from("event_orders")
      .select("warning_order, situation, mission, execution, support, command_and_signal")
      .eq("event_id", id)
      .maybeSingle(),
    supabase.from("attendance").select("event_id, member_id, reply, stand_in_position_id").eq("event_id", id),
    // The database returns only the lines this member may see: their own, or all of them to whoever runs the event.
    supabase.from("attendance_returns").select("member_id, returned").eq("event_id", id),
    supabase
      .from("after_action_reports")
      .select("what_happened, to_keep, to_change, author_id, filed_at")
      .eq("event_id", id)
      .maybeSingle(),
    supabase.from("roster").select("member_id, character_name, rank_name, status"),
    getOrderOfBattle(),
    readEventTypes(supabase),
  ]);
  for (const result of [found, orders, lines, marks, report, roster]) {
    if (result.error) throw new Error(`The event could not be read: ${result.error.message}`);
  }
  // A draft that is not this member's to see comes back as nothing at all.
  if (!found.data) return { state: "not-found" };

  const row = found.data as EventRow;
  // The event it was copied from, which comes back as nothing if it is a draft this member cannot see.
  const source = row.copied_from
    ? await supabase.from("events").select("id, title").eq("id", row.copied_from).maybeSingle()
    : { data: null, error: null };
  if (source.error) throw new Error(`The event could not be read: ${source.error.message}`);
  const rosterRows = (roster.data ?? []) as RosterRow[];
  const people = new Map(rosterRows.map((entry) => [entry.member_id, entry]));
  const event = toEvent(row, people, types, Date.now());
  const attendance = (lines.data ?? []) as AttendanceRow[];
  const roll = buildRoll(event, battle.state === "ready" ? openPosts(battle.fleet) : [], attendance, people);

  const runs = isCommand(member) || [row.commander_id, row.second_id].includes(member.id);
  const edits = runs || (row.state === "draft" && row.created_by === member.id);
  const myLine = attendance.find((line) => line.member_id === member.id);

  // The return covers everyone who replied, anyone holding an open post who did not, and anyone already marked.
  const returned = new Map(
    ((marks.data ?? []) as { member_id: string; returned: Returned }[]).map((mark) => [mark.member_id, mark.returned]),
  );
  const toReturn = new Map<string, ReturnLine>();
  if (runs) {
    for (const line of attendance) {
      const person = nameOf(people.get(line.member_id), line.member_id);
      if (person) toReturn.set(person.id, { person, reply: line.reply, returned: returned.get(person.id) ?? null });
    }
    for (const group of roll.groups) {
      for (const post of group.posts) {
        if (post.holder && !toReturn.has(post.holder.id)) {
          toReturn.set(post.holder.id, { person: post.holder, reply: null, returned: returned.get(post.holder.id) ?? null });
        }
      }
    }
    for (const [memberId, value] of returned) {
      const person = nameOf(people.get(memberId), memberId);
      if (person && !toReturn.has(memberId)) toReturn.set(memberId, { person, reply: null, returned: value });
    }
  }

  return {
    state: "ready",
    member,
    event,
    orders: {
      warning_order: orders.data?.warning_order ?? "",
      situation: orders.data?.situation ?? "",
      mission: orders.data?.mission ?? "",
      execution: orders.data?.execution ?? "",
      support: orders.data?.support ?? "",
      command_and_signal: orders.data?.command_and_signal ?? "",
    },
    sections: types.find((type) => type.key === row.kind)?.sections ?? sectionsFrom(() => null),
    copiedFrom: source.data ? { id: source.data.id as string, title: source.data.title as string } : null,
    roll,
    mine: {
      reply: myLine?.reply ?? null,
      standInFor: myLine?.stand_in_position_id ?? null,
      holdsAPost: member.postTitle !== null,
    },
    runs,
    edits,
    returns: [...toReturn.values()].sort((a, b) => a.person.name.localeCompare(b.person.name)),
    myReturn: returned.get(member.id) ?? null,
    report: report.data
      ? {
          whatHappened: report.data.what_happened,
          toKeep: report.data.to_keep,
          toChange: report.data.to_change,
          author: nameOf(report.data.author_id ? people.get(report.data.author_id) : undefined, report.data.author_id),
          filedAt: report.data.filed_at,
        }
      : null,
    people: edits
      ? rosterRows
          .filter((entry) => SERVING.includes(entry.status))
          .map((entry) => nameOf(entry, entry.member_id)!)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    mayCreate: typesFor(member, types),
    types,
  };
}

/** What the form for a new event needs: who may be named, and which kinds this member may draft. */
export async function getDraftingState(): Promise<
  | Outside
  | {
      state: "ready";
      member: Member;
      mayCreate: EventType[];
      people: Person[];
      /** A start to offer: three days out at 19:00 UTC, far enough ahead for the warning order. */
      suggested: { date: string; time: string };
    }
> {
  const who = await serving();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const [roster, types] = await Promise.all([
    supabase.from("roster").select("member_id, character_name, rank_name, status"),
    readEventTypes(supabase),
  ]);
  if (roster.error) throw new Error(`The fleet could not be read: ${roster.error.message}`);
  return {
    state: "ready",
    member: who.member,
    mayCreate: typesFor(who.member, types),
    suggested: { date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: "19:00" },
    people: ((roster.data ?? []) as RosterRow[])
      .filter((entry) => SERVING.includes(entry.status))
      .map((entry) => nameOf(entry, entry.member_id)!)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
