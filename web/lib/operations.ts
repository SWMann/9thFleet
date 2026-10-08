import "server-only";
import { inOwnPost, manningOf, unitsTakingPart, type Manning, type Place, type RollLine } from "@/lib/manning";
import { getSession, isServing, type Member, type Service } from "@/lib/member";
import {
  offsetFrom,
  sectionsFrom,
  serviceNames,
  type EventState,
  type Outcome,
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
  open_to_recruits: boolean;
  open_to_service: Service | null;
  requires_qualification_id: string | null;
  places: number | null;
  minimum_attending: number | null;
  muster_at: string;
  area: string;
  reading: string[] | null;
  teaches_qualification_id: string | null;
};
type AttendanceRow = {
  event_id: string;
  member_id: string;
  reply: Reply | null;
  stand_in_position_id: string | null;
  event_post_id: string | null;
  place: Place | null;
  replied_at: string | null;
};
type ExtraPostRow = {
  id: string;
  event_id: string;
  title: string;
  role_id: string | null;
  must_fill: boolean;
  open_to_volunteers: boolean;
  sort_order: number;
};
type RosterRow = { member_id: string; character_name: string | null; rank_name: string | null; status: string };

const EVENT =
  "id, kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id, weapons_state, pve_fallback, state, created_by, announced_at, roll_closes_at, copied_from, repeats_weekly, open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending, muster_at, area, reading, teaches_qualification_id";
const ATTENDANCE = "event_id, member_id, reply, stand_in_position_id, event_post_id, place, replied_at";
const EXTRA_POST = "id, event_id, title, role_id, must_fill, open_to_volunteers, sort_order";
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
  /** Who it is open to. */
  openToRecruits: boolean;
  openToService: Service | null;
  requires: { id: string; name: string } | null;
  /** How many can attend, and how many must. Null for no limit and no minimum. */
  places: number | null;
  minimumAttending: number | null;
  /** Where to muster, and the area the event works in. Empty when not given. */
  musterAt: string;
  area: string;
  /** Sections of the manual to read first, each as volume/section. */
  reading: string[];
  /** The qualification it teaches, which an instructor signs off for those who pass. */
  teaches: { id: string; name: string } | null;
};

/** One primary post on the night: who holds it, whether they are coming, and who stands in if not. */
export type RollPost = {
  id: string;
  title: string;
  entry: boolean;
  /** The event cannot go ahead with this post empty. */
  mustFill: boolean;
  holder: Person | null;
  holderReply: Reply | null;
  /** Its holder is attending, but has been moved to another post for the night. */
  holderMoved: boolean;
  /** Its holder is attending, but on the reserve list. */
  holderOnReserve: boolean;
  standIn: Person | null;
  /**
   * confirmed: its holder is attending and in it. stand-in: someone fills it for the night.
   * empty: nobody will be in it. waiting: its holder has not replied and the roll is still open.
   */
  state: "confirmed" | "stand-in" | "empty" | "waiting";
};
export type RollGroup = { unit: string; posts: RollPost[] };

/** A post that exists for this event only. */
export type ExtraPost = {
  id: string;
  title: string;
  /** The role it is, with its page on the site if it has one. */
  role: { name: string; href: string | null } | null;
  mustFill: boolean;
  openToVolunteers: boolean;
  holder: Person | null;
};

export type Roll = {
  groups: RollGroup[];
  /** The event's own posts, in the order they were given. */
  extra: ExtraPost[];
  /** Counted across the order of battle's posts and the event's own. */
  posts: number;
  confirmed: number;
  empty: number;
  waiting: number;
  /** Attending with a place and no post on the night: the people a stand-in usually comes from. */
  spare: Person[];
  /** Attending in their own post. Whoever runs the event can move one up for the night. */
  inPost: Person[];
  /** Attending and waiting for a place, the first in line first. */
  reserve: Person[];
  /** Everyone attending with a place, for moving one of them to the reserve list. */
  withPlace: Person[];
  notAttending: Person[];
};

export type Summary = FleetEvent & {
  myReply: Reply | null;
  myPlace: Place | null;
  posts: number;
  confirmed: number;
  manning: Manning | null;
};

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

type FlatUnit = { id: string; parentId: string | null; name: string; open: boolean; path: string };

/** Every unit of the order of battle, flat, each with the one above it. */
function flatUnits(fleet: Unit): FlatUnit[] {
  const list: FlatUnit[] = [];
  const walk = (unit: Unit, parent: Unit | null, above: string[]) => {
    // The fleet itself is left out of a unit's path: "Task Force Jericho › UEES Nexus".
    const path = parent ? [...above, unit.name] : [];
    list.push({ id: unit.id, parentId: parent?.id ?? null, name: unit.name, open: unit.open, path: path.join(" › ") || unit.name });
    for (const child of unit.units) walk(child, unit, path);
  };
  walk(fleet, null, []);
  return list;
}

/**
 * The open primary posts, grouped by the unit they sit in, in the order of
 * battle's own order. With units named, only the posts in those units and under them.
 */
function openPosts(fleet: Unit, taking: Set<string> | null) {
  const groups: { unit: string; posts: Unit["posts"] }[] = [];
  const walk = (unit: Unit, above: string | null) => {
    const posts = taking && !taking.has(unit.id) ? [] : unit.posts.filter((post) => post.kind === "primary" && post.open);
    // A department is named with its ship: "UEES Nexus, Gunnery".
    const name = unit.kind === "department" && above ? `${above}, ${unit.name}` : unit.name;
    if (posts.length > 0) groups.push({ unit: name, posts });
    for (const child of unit.units) walk(child, unit.name);
  };
  walk(fleet, null);
  return groups;
}

function toEvent(
  row: EventRow,
  people: Map<string, RosterRow>,
  types: EventType[],
  qualifications: Map<string, string>,
  now: number,
): FleetEvent {
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
    openToRecruits: row.open_to_recruits !== false,
    openToService: row.open_to_service,
    requires: row.requires_qualification_id
      ? { id: row.requires_qualification_id, name: qualifications.get(row.requires_qualification_id) ?? "A qualification" }
      : null,
    places: row.places,
    minimumAttending: row.minimum_attending,
    musterAt: row.muster_at ?? "",
    area: row.area ?? "",
    reading: row.reading ?? [],
    teaches: row.teaches_qualification_id
      ? { id: row.teaches_qualification_id, name: qualifications.get(row.teaches_qualification_id) ?? "A qualification" }
      : null,
  };
}

const toLine = (row: AttendanceRow): RollLine => ({
  memberId: row.member_id,
  reply: row.reply,
  place: row.place,
  standInFor: row.stand_in_position_id,
  extraPost: row.event_post_id,
  repliedAt: row.replied_at,
});

type RoleLink = { name: string; href: string | null };

function buildRoll(
  event: FleetEvent,
  groups: ReturnType<typeof openPosts>,
  lines: RollLine[],
  people: Map<string, RosterRow>,
  keyPosts: Set<string>,
  extraPosts: ExtraPostRow[],
  roles: Map<string, RoleLink>,
): Roll {
  const byMember = new Map(lines.map((line) => [line.memberId, line]));
  const standIns = new Map<string, string>();
  const inExtra = new Map<string, string>();
  for (const line of lines) {
    if (line.standInFor) standIns.set(line.standInFor, line.memberId);
    if (line.extraPost) inExtra.set(line.extraPost, line.memberId);
  }
  const person = (id: string | null) => nameOf(id ? people.get(id) : undefined, id);

  // Everyone with somewhere to be on the night: in their own post, or in someone else's.
  const placed = new Set<string>([...standIns.values(), ...inExtra.values()]);
  const roll: Roll = {
    groups: [],
    extra: [],
    posts: 0,
    confirmed: 0,
    empty: 0,
    waiting: 0,
    spare: [],
    inPost: [],
    reserve: [],
    withPlace: [],
    notAttending: [],
  };
  for (const group of groups) {
    const posts = group.posts.map((post): RollPost => {
      const held = post.holders[0];
      const holder = held ? { id: held.memberId, name: held.name ?? "A member with no name set", rankName: held.rankName } : null;
      const holderLine = holder ? byMember.get(holder.id) : undefined;
      const holderReply = holderLine?.reply ?? null;
      const standIn = person(standIns.get(post.id) ?? null);
      if (holder) placed.add(holder.id);

      const holderIn = inOwnPost(holderLine);
      const holderMoved = holderLine?.place === "in" && !holderIn;
      const holderOnReserve = holderLine?.place === "reserve";
      const state = holderIn
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
      return {
        id: post.id,
        title: post.title,
        entry: post.entry,
        mustFill: keyPosts.has(post.id),
        holder,
        holderReply,
        holderMoved,
        holderOnReserve,
        standIn,
        state,
      };
    });
    roll.groups.push({ unit: group.unit, posts });
  }

  const inOrder = [...extraPosts].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "en", { numeric: true }),
  );
  for (const post of inOrder) {
    const holder = person(inExtra.get(post.id) ?? null);
    roll.posts += 1;
    if (holder) roll.confirmed += 1;
    else roll.empty += 1;
    roll.extra.push({
      id: post.id,
      title: post.title,
      role: post.role_id ? (roles.get(post.role_id) ?? null) : null,
      mustFill: post.must_fill,
      openToVolunteers: post.open_to_volunteers,
      holder,
    });
  }

  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  // The reserve list is read in the order replies arrived.
  const waiting = lines
    .filter((line) => line.place === "reserve")
    .sort((a, b) => (a.repliedAt ?? "").localeCompare(b.repliedAt ?? "") || a.memberId.localeCompare(b.memberId));
  for (const line of waiting) {
    const who = person(line.memberId);
    if (who) roll.reserve.push(who);
  }
  for (const line of lines) {
    const who = person(line.memberId);
    if (!who) continue;
    if (line.place === "in") {
      roll.withPlace.push(who);
      if (!placed.has(line.memberId)) roll.spare.push(who);
    }
    if (line.reply === "not_attending") roll.notAttending.push(who);
  }
  roll.spare.sort(byName);
  roll.inPost.sort(byName);
  roll.withPlace.sort(byName);
  roll.notAttending.sort(byName);
  return roll;
}

/** Whether an event has what it needs, from its roll. */
function manningFor(event: FleetEvent, roll: Roll, lines: RollLine[]): Manning | null {
  // Only an announced event is manned or not. A draft has no roll, and a closed one is over.
  if (event.state !== "announced") return null;
  return manningOf({
    minimum: event.minimumAttending,
    keyPosts: roll.groups
      .flatMap((group) => group.posts)
      .filter((post) => post.mustFill)
      .map((post) => ({ id: post.id, title: post.title, holderId: post.holder?.id ?? null })),
    extraPosts: roll.extra,
    lines,
    rollOpen: event.rollOpen,
  });
}

/** What the pages need before anything else: the member, and that they serve. */
async function serving(): Promise<Outside | { state: "ready"; member: Member }> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  // Events are for the serving fleet. The database returns none to anyone else.
  if (!isServing(session.member)) return { state: "outside" };
  return { state: "ready", member: session.member };
}

/** The qualifications, by name. Anyone may read these. */
async function readQualifications(supabase: Client): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from("qualifications").select("id, name");
  if (error) throw new Error(`The qualifications could not be read: ${error.message}`);
  return ((data ?? []) as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every event the member may see, sorted into drafts, what is coming and what has been. */
export async function getOperations(): Promise<Operations> {
  const who = await serving();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [events, roster, battle, types, qualifications] = await Promise.all([
    supabase.from("events").select(EVENT).order("starts_at", { ascending: true }),
    supabase.from("roster").select("member_id, character_name, rank_name, status"),
    getOrderOfBattle(),
    readEventTypes(supabase),
    readQualifications(supabase),
  ]);
  for (const result of [events, roster]) {
    if (result.error) throw new Error(`The events could not be read: ${result.error.message}`);
  }
  const rows = (events.data ?? []) as EventRow[];
  const ids = rows.map((row) => row.id);
  const none = { data: [] as unknown[], error: null };
  const [lines, units, keyPosts, extraPosts] =
    ids.length > 0
      ? await Promise.all([
          supabase.from("attendance").select(ATTENDANCE).in("event_id", ids),
          supabase.from("event_units").select("event_id, unit_id").in("event_id", ids),
          supabase.from("event_key_posts").select("event_id, position_id").in("event_id", ids),
          supabase.from("event_posts").select(EXTRA_POST).in("event_id", ids),
        ])
      : [none, none, none, none];
  for (const result of [lines, units, keyPosts, extraPosts]) {
    if (result.error) throw new Error(`The roll could not be read: ${result.error.message}`);
  }

  const people = new Map(((roster.data ?? []) as RosterRow[]).map((row) => [row.member_id, row]));
  const qualificationName = new Map(qualifications.map((entry) => [entry.id, entry.name]));
  const allUnits = battle.state === "ready" ? flatUnits(battle.fleet) : [];
  const now = Date.now();

  const summaries = rows.map((row): Summary => {
    const event = toEvent(row, people, types, qualificationName, now);
    const mine = ((lines.data ?? []) as AttendanceRow[]).filter((line) => line.event_id === row.id).map(toLine);
    const named = ((units.data ?? []) as { event_id: string; unit_id: string }[])
      .filter((entry) => entry.event_id === row.id)
      .map((entry) => entry.unit_id);
    const groups = battle.state === "ready" ? openPosts(battle.fleet, unitsTakingPart(allUnits, named)) : [];
    const key = new Set(
      ((keyPosts.data ?? []) as { event_id: string; position_id: string }[])
        .filter((entry) => entry.event_id === row.id)
        .map((entry) => entry.position_id),
    );
    const extra = ((extraPosts.data ?? []) as ExtraPostRow[]).filter((entry) => entry.event_id === row.id);
    const roll = buildRoll(event, groups, mine, people, key, extra, new Map());
    const own = mine.find((line) => line.memberId === who.member.id);
    return {
      ...event,
      myReply: own?.reply ?? null,
      myPlace: own?.place ?? null,
      posts: roll.posts,
      confirmed: roll.confirmed,
      manning: manningFor(event, roll, mine),
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

/** What someone who may change an event can choose from. */
export type Choices = {
  /** The open units, each with the ones above it in its name. */
  units: { id: string; label: string }[];
  /** The open primary posts of the units taking part, for saying which must be filled. */
  posts: { unit: string; posts: { id: string; title: string }[] }[];
  roles: { id: string; name: string }[];
  qualifications: { id: string; name: string }[];
};

/** The parts of the plan that are lists: each as the editor and the event's page need it. */
export type Plan = {
  objectives: { id: string; title: string }[];
  elements: { id: string; name: string; callsign: string; task: string }[];
  /** In order of time. `at` is the moment itself, worked out from the event's start. */
  timings: { id: string; offsetMinutes: number; label: string; at: string }[];
  ships: { id: string; ship: string; note: string }[];
  nets: { id: string; name: string; purpose: string; controller: string }[];
};

export type Amendment = { number: number; body: string; issuedBy: Person | null; issuedAt: string };

/** What the after-action report records beyond its words. */
export type ReportRecords = {
  /** How each objective turned out, by the objective's id. One not answered yet is not in it. */
  outcomes: Record<string, { outcome: Outcome; note: string }>;
  losses: { id: string; item: string; quantity: number; note: string }[];
  mentions: { id: string; person: Person; citation: string }[];
};

/** For an instructor, at an event that teaches a qualification: who can be signed off. */
export type SignOff = {
  qualification: { id: string; name: string };
  /** Everyone who was there, by the return if this member can see it, and otherwise by the roll. */
  candidates: { person: Person; holds: boolean }[];
};

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
      /** The units the event names, and the posts it says must be filled. With no unit named, every open unit takes part. */
      taking: { units: string[]; names: string[]; keyPosts: string[] };
      roll: Roll;
      /** Whether the event has what it needs. Null when it sets no minimum, or is not announced. */
      manning: Manning | null;
      /** The member's own line on the roll. */
      mine: {
        reply: Reply | null;
        place: Place | null;
        /** Where they are on the reserve list, counting from one. */
        reserveNumber: number | null;
        standInFor: string | null;
        extraPost: string | null;
        /** Whether they hold a post that is part of this event. */
        holdsAPost: boolean;
        /** Why they cannot attend, if the event is not open to them. */
        notOpen: string | null;
      };
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
      /** What can be chosen when changing the event. Empty lists for someone who may not. */
      choices: Choices;
      plan: Plan;
      /** Changes to the orders since the event was announced, the latest first. */
      amendments: Amendment[];
      /** The latest amendment this member has acknowledged, if any. */
      acknowledged: number | null;
      /**
       * For whoever runs the event: who of those attending has not acknowledged the latest amendment.
       * Empty for everyone else, and when there is no amendment.
       */
      awaiting: Person[];
      records: ReportRecords;
      /** Who was signed off at this event, for everyone to read. */
      passed: Person[];
      /** Set for an instructor once the event has started, if it teaches a qualification. */
      signOff: SignOff | null;
      /** Everyone who was there, for whoever writes the report to mention. Empty for anyone else. */
      present: Person[];
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

  const [
    found, orders, lines, marks, report, roster, units, keyPosts, extraPosts, awards, roleRows, areaRows,
    objectives, elements, timings, ships, nets, amendments, acknowledgements,
    outcomes, losses, mentions, passes,
    battle, types, qualifications,
  ] = await Promise.all([
      supabase.from("events").select(EVENT).eq("id", id).maybeSingle(),
      supabase
        .from("event_orders")
        .select("warning_order, situation, mission, execution, support, command_and_signal")
        .eq("event_id", id)
        .maybeSingle(),
      supabase.from("attendance").select(ATTENDANCE).eq("event_id", id),
      // The database returns only the lines this member may see: their own, or all of them to whoever runs the event.
      supabase.from("attendance_returns").select("member_id, returned").eq("event_id", id),
      supabase
        .from("after_action_reports")
        .select("what_happened, to_keep, to_change, author_id, filed_at")
        .eq("event_id", id)
        .maybeSingle(),
      supabase.from("roster").select("member_id, character_name, rank_name, status"),
      supabase.from("event_units").select("event_id, unit_id").eq("event_id", id),
      supabase.from("event_key_posts").select("event_id, position_id").eq("event_id", id),
      supabase.from("event_posts").select(EXTRA_POST).eq("event_id", id),
      supabase.from("qualification_awards").select("qualification_id").eq("member_id", member.id),
      supabase.from("fleet_roles").select("id, name, slug, area_id"),
      supabase.from("areas").select("id, slug"),
      supabase.from("event_objectives").select("id, title, sort_order").eq("event_id", id),
      supabase.from("event_elements").select("id, name, callsign, task, sort_order").eq("event_id", id),
      supabase.from("event_timings").select("id, offset_minutes, label").eq("event_id", id),
      supabase.from("event_ships").select("id, ship, note, sort_order").eq("event_id", id),
      supabase.from("event_nets").select("id, name, purpose, controller, sort_order").eq("event_id", id),
      supabase.from("event_amendments").select("number, body, issued_by, issued_at").eq("event_id", id),
      // The database returns this member's own line, or every line to whoever runs the event.
      supabase.from("event_acknowledgements").select("member_id, amendment_number").eq("event_id", id),
      supabase.from("event_objective_outcomes").select("objective_id, outcome, note").eq("event_id", id),
      supabase.from("event_losses").select("id, item, quantity, note, recorded_at").eq("event_id", id),
      supabase.from("event_mentions").select("id, member_id, citation, mentioned_at").eq("event_id", id),
      supabase.from("qualification_awards").select("member_id").eq("event_id", id),
      getOrderOfBattle(),
      readEventTypes(supabase),
      readQualifications(supabase),
    ]);
  for (const result of [
    found, orders, lines, marks, report, roster, units, keyPosts, extraPosts, awards, roleRows, areaRows,
    objectives, elements, timings, ships, nets, amendments, acknowledgements,
    outcomes, losses, mentions, passes,
  ]) {
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
  const qualificationName = new Map(qualifications.map((entry) => [entry.id, entry.name]));
  const event = toEvent(row, people, types, qualificationName, Date.now());
  const attendance = ((lines.data ?? []) as AttendanceRow[]).map(toLine);

  const allUnits = battle.state === "ready" ? flatUnits(battle.fleet) : [];
  const named = ((units.data ?? []) as { unit_id: string }[]).map((entry) => entry.unit_id);
  const groups = battle.state === "ready" ? openPosts(battle.fleet, unitsTakingPart(allUnits, named)) : [];
  const key = new Set(((keyPosts.data ?? []) as { position_id: string }[]).map((entry) => entry.position_id));
  const areaSlug = new Map(((areaRows.data ?? []) as { id: string; slug: string }[]).map((area) => [area.id, area.slug]));
  const roles = new Map(
    ((roleRows.data ?? []) as { id: string; name: string; slug: string; area_id: string }[]).map((role) => [
      role.id,
      { name: role.name, href: areaSlug.has(role.area_id) ? `/roles/${areaSlug.get(role.area_id)}/${role.slug}` : null },
    ]),
  );
  const roll = buildRoll(event, groups, attendance, people, key, (extraPosts.data ?? []) as ExtraPostRow[], roles);

  const runs = isCommand(member) || [row.commander_id, row.second_id].includes(member.id);
  const edits = runs || (row.state === "draft" && row.created_by === member.id);
  const myLine = attendance.find((line) => line.memberId === member.id);

  // Whether the event is open to this member. Whoever is named to run it or to observe always is.
  const isNamed = [row.commander_id, row.second_id, row.observer_id].includes(member.id);
  const held = new Set(((awards.data ?? []) as { qualification_id: string }[]).map((award) => award.qualification_id));
  const notOpen = isNamed
    ? null
    : !event.openToRecruits && member.status === "recruit"
      ? "This event is not open to recruits."
      : event.openToService && member.service !== event.openToService
        ? `This event is for the ${serviceNames[event.openToService]}.`
        : event.requires && !held.has(event.requires.id)
          ? `This event needs the ${event.requires.name} qualification.`
          : null;

  // The return covers everyone who replied, anyone holding an open post who did not, and anyone already marked.
  const returned = new Map(
    ((marks.data ?? []) as { member_id: string; returned: Returned }[]).map((mark) => [mark.member_id, mark.returned]),
  );
  const toReturn = new Map<string, ReturnLine>();
  if (runs) {
    for (const line of attendance) {
      const person = nameOf(people.get(line.memberId), line.memberId);
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

  const reserveAt = roll.reserve.findIndex((person) => person.id === member.id);

  // The plan's lists, each in its own order.
  type Ordered = { sort_order: number };
  const inOrder = <T extends Ordered>(rows: unknown) => ((rows ?? []) as T[]).sort((a, b) => a.sort_order - b.sort_order);
  const plan: Plan = {
    objectives: inOrder<Ordered & { id: string; title: string }>(objectives.data).map((entry) => ({ id: entry.id, title: entry.title })),
    elements: inOrder<Ordered & Plan["elements"][number]>(elements.data).map((entry) => ({
      id: entry.id,
      name: entry.name,
      callsign: entry.callsign,
      task: entry.task,
    })),
    timings: ((timings.data ?? []) as { id: string; offset_minutes: number; label: string }[])
      .sort((a, b) => a.offset_minutes - b.offset_minutes || a.label.localeCompare(b.label))
      .map((entry) => ({ id: entry.id, offsetMinutes: entry.offset_minutes, label: entry.label, at: offsetFrom(row.starts_at, entry.offset_minutes) })),
    ships: inOrder<Ordered & Plan["ships"][number]>(ships.data).map((entry) => ({ id: entry.id, ship: entry.ship, note: entry.note })),
    nets: inOrder<Ordered & Plan["nets"][number]>(nets.data).map((entry) => ({
      id: entry.id,
      name: entry.name,
      purpose: entry.purpose,
      controller: entry.controller,
    })),
  };

  const issued = ((amendments.data ?? []) as { number: number; body: string; issued_by: string | null; issued_at: string }[])
    .sort((a, b) => b.number - a.number)
    .map((entry): Amendment => ({
      number: entry.number,
      body: entry.body,
      issuedBy: nameOf(entry.issued_by ? people.get(entry.issued_by) : undefined, entry.issued_by),
      issuedAt: entry.issued_at,
    }));
  const latest = issued[0]?.number ?? null;
  const acknowledgedBy = new Map(
    ((acknowledgements.data ?? []) as { member_id: string; amendment_number: number }[]).map((entry) => [entry.member_id, entry.amendment_number]),
  );
  // Everyone attending is asked to acknowledge the latest amendment, whether they have a place yet or not.
  const awaiting =
    runs && latest !== null
      ? attendance
          .filter((line) => line.reply === "attending" && (acknowledgedBy.get(line.memberId) ?? 0) < latest)
          .map((line) => nameOf(people.get(line.memberId), line.memberId)!)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  // Who was there: by the attendance return where this member can see it, and otherwise by the roll.
  const there = new Map<string, Person>();
  for (const line of attendance) {
    const mark = returned.get(line.memberId);
    const person = nameOf(people.get(line.memberId), line.memberId);
    if (person && (mark ? mark === "present" : line.place === "in")) there.set(person.id, person);
  }
  for (const [memberId, mark] of returned) {
    const person = nameOf(people.get(memberId), memberId);
    if (person && mark === "present") there.set(memberId, person);
  }
  const present = [...there.values()].sort((a, b) => a.name.localeCompare(b.name));

  // An instructor signs off who passed, once the event has started. The database checks both again.
  const mayAward = isServing(member) && (member.roles.includes("instructor") || member.roles.includes("admin"));
  let signOff: SignOff | null = null;
  if (mayAward && event.teaches && event.started && (row.state === "announced" || row.state === "done")) {
    const holders = await supabase.from("qualification_awards").select("member_id").eq("qualification_id", event.teaches.id);
    if (holders.error) throw new Error(`The event could not be read: ${holders.error.message}`);
    const holds = new Set(((holders.data ?? []) as { member_id: string }[]).map((entry) => entry.member_id));
    signOff = {
      qualification: event.teaches,
      // Nobody signs off their own qualification.
      candidates: present.filter((person) => person.id !== member.id).map((person) => ({ person, holds: holds.has(person.id) })),
    };
  }

  const records: ReportRecords = {
    outcomes: Object.fromEntries(
      ((outcomes.data ?? []) as { objective_id: string; outcome: Outcome; note: string }[]).map((entry) => [
        entry.objective_id,
        { outcome: entry.outcome, note: entry.note },
      ]),
    ),
    losses: ((losses.data ?? []) as { id: string; item: string; quantity: number; note: string; recorded_at: string }[])
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .map((entry) => ({ id: entry.id, item: entry.item, quantity: entry.quantity, note: entry.note })),
    mentions: ((mentions.data ?? []) as { id: string; member_id: string; citation: string; mentioned_at: string }[])
      .sort((a, b) => a.mentioned_at.localeCompare(b.mentioned_at))
      .map((entry) => ({ id: entry.id, person: nameOf(people.get(entry.member_id), entry.member_id)!, citation: entry.citation })),
  };

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
    taking: {
      units: named,
      names: allUnits.filter((unit) => named.includes(unit.id)).map((unit) => unit.name),
      keyPosts: [...key],
    },
    roll,
    manning: manningFor(event, roll, attendance),
    mine: {
      reply: myLine?.reply ?? null,
      place: myLine?.place ?? null,
      reserveNumber: reserveAt >= 0 ? reserveAt + 1 : null,
      standInFor: myLine?.standInFor ?? null,
      extraPost: myLine?.extraPost ?? null,
      holdsAPost: roll.groups.some((group) => group.posts.some((post) => post.holder?.id === member.id)),
      notOpen,
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
    choices: edits
      ? {
          // The fleet itself is every unit, which is what naming none already means.
          units: allUnits.filter((unit) => unit.open && unit.parentId !== null).map((unit) => ({ id: unit.id, label: unit.path })),
          posts: groups.map((group) => ({ unit: group.unit, posts: group.posts.map((post) => ({ id: post.id, title: post.title })) })),
          roles: [...roles.entries()].map(([roleId, role]) => ({ id: roleId, name: role.name })).sort((a, b) => a.name.localeCompare(b.name)),
          qualifications,
        }
      : { units: [], posts: [], roles: [], qualifications: [] },
    plan,
    amendments: issued,
    acknowledged: acknowledgedBy.get(member.id) ?? null,
    awaiting,
    records,
    passed: ((passes.data ?? []) as { member_id: string }[])
      .map((entry) => nameOf(people.get(entry.member_id), entry.member_id)!)
      .sort((a, b) => a.name.localeCompare(b.name)),
    signOff,
    // Whoever writes the report mentions someone who was there, and never themselves.
    present: runs ? present.filter((person) => person.id !== member.id) : [],
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
      qualifications: { id: string; name: string }[];
      /** A start to offer: three days out at 19:00 UTC, far enough ahead for the warning order. */
      suggested: { date: string; time: string };
    }
> {
  const who = await serving();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const [roster, types, qualifications] = await Promise.all([
    supabase.from("roster").select("member_id, character_name, rank_name, status"),
    readEventTypes(supabase),
    readQualifications(supabase),
  ]);
  if (roster.error) throw new Error(`The fleet could not be read: ${roster.error.message}`);
  return {
    state: "ready",
    member: who.member,
    mayCreate: typesFor(who.member, types),
    qualifications,
    suggested: { date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: "19:00" },
    people: ((roster.data ?? []) as RosterRow[])
      .filter((entry) => SERVING.includes(entry.status))
      .map((entry) => nameOf(entry, entry.member_id)!)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
