import "server-only";
import { cache } from "react";
import { refused } from "@/lib/activity";
import { getSession, isServing, type Member, type Role, type Service, type Status } from "@/lib/member";
import { manningOf, shortfall, unitsTakingPart, type Manning, type Place } from "@/lib/manning";
import type { EventState, Reply, Returned } from "@/lib/operations-form";
import { createClient } from "@/lib/supabase/server";

/**
 * The admin pages: figures about the fleet for the people who run it.
 *
 * Everything is read as the signed-in person, so the database's rules decide
 * which rows come back. The tiers below only decide which pages the site
 * offers. They are not the lock.
 *
 * The figures are worked out here from whole tables. That suits a fleet of
 * hundreds. Supabase returns at most a thousand rows to one request, so past
 * that the counting moves into the database.
 */

/** Staff see people and recruiting. Command also sees operations. Admins see everything. */
export type Tier = "staff" | "command" | "admin";
const ORDER: Tier[] = ["staff", "command", "admin"];

export function tierOf(member: Member): Tier | null {
  if (!isServing(member)) return null;
  if (member.roles.includes("admin")) return "admin";
  if (member.roles.includes("command")) return "command";
  if (member.roles.includes("staff")) return "staff";
  return null;
}

export const reaches = (tier: Tier, needed: Tier) => ORDER.indexOf(tier) >= ORDER.indexOf(needed);

export type Gate =
  | { state: "no-database" }
  | { state: "signed-out" }
  | { state: "no-record" }
  /** Signed in, but this page is for a tier they do not hold. */
  | { state: "not-allowed"; tier: Tier | null; needed: Tier }
  | { state: "ready"; member: Member; tier: Tier };

/**
 * Who is asking, and whether the page is for them. Nobody is offered a link to
 * an admin page their role does not open, so reaching one anyway is written to
 * the activity log.
 */
export async function gate(needed: Tier, page: string): Promise<Gate> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  const tier = tierOf(session.member);
  if (!tier || !reaches(tier, needed)) {
    const supabase = await createClient();
    if (supabase) await refused(supabase, "page.admin", `${page} is for ${needed === "admin" ? "admins" : needed}.`);
    return { state: "not-allowed", tier, needed };
  }
  return { state: "ready", member: session.member, tier };
}

/**
 * The active strength each stage needs, from the roadmap. A stage opens two
 * months after its strength is reached.
 */
export const stages: { stage: number; name: string; from: number; to: number }[] = [
  { stage: 1, name: "Cadre", from: 1, to: 7 },
  { stage: 2, name: "Ship's company", from: 8, to: 15 },
  { stage: 3, name: "Ship and air wing", from: 16, to: 30 },
  { stage: 4, name: "Task group", from: 31, to: 55 },
  { stage: 5, name: "Task force", from: 56, to: 90 },
  { stage: 6, name: "Squadron", from: 91, to: 200 },
  { stage: 7, name: "Battle group", from: 201, to: 450 },
  { stage: 8, name: "Two battle groups", from: 451, to: 900 },
  { stage: 9, name: "Fleet", from: 901, to: 1500 },
];

const DAY = 24 * 60 * 60 * 1000;
const SERVING: Status[] = ["recruit", "auxiliary", "member", "reserve"];
/** Active strength: serving and not in reserve. */
const ACTIVE: Status[] = ["recruit", "auxiliary", "member"];

export type Person = {
  id: string;
  name: string;
  rsiHandle: string | null;
  discordName: string | null;
  status: Status;
  service: Service | null;
  gradeCode: string | null;
  rankName: string | null;
  acting: boolean;
  postTitle: string | null;
  unitName: string | null;
  dutyTitle: string | null;
  /** The day their record was made: the day they first signed in. */
  joinedOn: string;
  daysIn: number;
  roles: Role[];
  qualifications: string[];
  /** Events they were returned present at, in the last 30 and 90 days and in all. */
  attended30: number;
  attended90: number;
  attendedAll: number;
  absentWithoutNotice90: number;
  lastAttended: string | null;
  /** How many announced events they replied to, of those they could have. */
  standIns: number;
};

type Row = Record<string, unknown>;

export type Fleet = {
  now: number;
  stage: number;
  recruitmentOpen: boolean;
  people: Person[];
  units: { id: string; parent_id: string | null; name: string; kind: string; opens_at_stage: number }[];
  positions: {
    id: string;
    unit_id: string;
    title: string;
    kind: "primary" | "duty";
    is_entry: boolean;
    opens_at_stage: number;
  }[];
  assignments: {
    id: string;
    member_id: string;
    position_id: string;
    kind: "primary" | "duty";
    acting: boolean;
    started_on: string;
    ended_on: string | null;
  }[];
  qualifications: { id: string; name: string }[];
  awards: { member_id: string; qualification_id: string; awarded_on: string }[];
  applications: {
    id: string;
    member_id: string;
    stage: "submitted" | "interview" | "accepted" | "declined" | "withdrawn";
    route: "recruit" | "cadet";
    preferred_service: Service;
    submitted_at: string;
    decided_at: string | null;
  }[];
  /** The types of event, in the Fleet Commander's order. */
  eventTypes: { key: string; name: string }[];
  events: {
    id: string;
    kind: string;
    title: string;
    starts_at: string;
    state: EventState;
    commander_id: string | null;
    roll_closes_at: string | null;
    minimum_attending: number | null;
  }[];
  attendance: {
    event_id: string;
    member_id: string;
    reply: Reply | null;
    stand_in_position_id: string | null;
    event_post_id: string | null;
    place: Place | null;
    replied_at: string | null;
  }[];
  /** Who takes part in each event: the units it names, the posts that must be filled, and its own posts. */
  eventUnits: { event_id: string; unit_id: string }[];
  eventKeyPosts: { event_id: string; position_id: string }[];
  eventPosts: { id: string; event_id: string; title: string; must_fill: boolean }[];
  returns: { event_id: string; member_id: string; returned: Returned }[];
  reports: { event_id: string; filed_at: string }[];
};

export type Loaded = { state: "no-database" } | { state: "ready"; fleet: Fleet };

/** Every table the figures draw on, read once for the request and shared by the page's parts. */
export const loadFleet = cache(async (): Promise<Loaded> => {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [settings, roster, members, accounts, roles, units, positions, assignments, qualifications, awards, applications, events, attendance, returns, reports, eventTypes, eventUnits, eventKeyPosts, eventPosts] =
    await Promise.all([
      supabase.from("fleet_settings").select("current_stage, recruitment_open").maybeSingle(),
      supabase
        .from("roster")
        .select("member_id, character_name, rsi_handle, service, status, grade_code, rank_name, acting, position_title, unit_name"),
      supabase.from("members").select("id, joined_on"),
      supabase.from("member_accounts").select("member_id, discord_name"),
      supabase.from("member_roles").select("member_id, role"),
      supabase.from("units").select("id, parent_id, name, kind, opens_at_stage"),
      supabase.from("positions").select("id, unit_id, title, kind, is_entry, opens_at_stage"),
      supabase.from("assignments").select("id, member_id, position_id, kind, acting, started_on, ended_on"),
      supabase.from("qualifications").select("id, name"),
      supabase.from("qualification_awards").select("member_id, qualification_id, awarded_on"),
      supabase
        .from("applications")
        .select("id, member_id, stage, route, preferred_service, submitted_at, decided_at")
        .order("submitted_at", { ascending: false }),
      supabase
        .from("events")
        .select("id, kind, title, starts_at, state, commander_id, roll_closes_at, minimum_attending")
        .order("starts_at", { ascending: true }),
      supabase.from("attendance").select("event_id, member_id, reply, stand_in_position_id, event_post_id, place, replied_at"),
      supabase.from("attendance_returns").select("event_id, member_id, returned"),
      supabase.from("after_action_reports").select("event_id, filed_at"),
      supabase.from("event_types").select("key, name, sort_order").order("sort_order", { ascending: true }),
      supabase.from("event_units").select("event_id, unit_id"),
      supabase.from("event_key_posts").select("event_id, position_id"),
      supabase.from("event_posts").select("id, event_id, title, must_fill"),
    ]);
  const results = { settings, roster, members, accounts, roles, units, positions, assignments, qualifications, awards, applications, events, attendance, returns, reports, eventTypes, eventUnits, eventKeyPosts, eventPosts };
  for (const [name, result] of Object.entries(results)) {
    if (result.error) throw new Error(`The ${name} could not be read: ${result.error.message}`);
  }

  const now = Date.now();
  const rows = <T>(result: { data: unknown }) => (result.data ?? []) as T[];

  const joined = new Map(rows<Row>(members).map((row) => [row.id as string, row.joined_on as string]));
  const discord = new Map(rows<Row>(accounts).map((row) => [row.member_id as string, row.discord_name as string | null]));
  const rolesOf = new Map<string, Role[]>();
  for (const row of rows<Row>(roles)) {
    const list = rolesOf.get(row.member_id as string) ?? [];
    list.push(row.role as Role);
    rolesOf.set(row.member_id as string, list);
  }

  const fleetAssignments = rows<Fleet["assignments"][number]>(assignments);
  const fleetPositions = rows<Fleet["positions"][number]>(positions);
  const positionTitle = new Map(fleetPositions.map((position) => [position.id, position.title]));
  const dutyOf = new Map<string, string>();
  for (const assignment of fleetAssignments) {
    if (assignment.kind === "duty" && !assignment.ended_on) {
      dutyOf.set(assignment.member_id, positionTitle.get(assignment.position_id) ?? "A duty");
    }
  }

  const fleetQualifications = rows<Fleet["qualifications"][number]>(qualifications);
  const qualificationName = new Map(fleetQualifications.map((entry) => [entry.id, entry.name]));
  const fleetAwards = rows<Fleet["awards"][number]>(awards);
  const heldBy = new Map<string, string[]>();
  for (const award of fleetAwards) {
    const list = heldBy.get(award.member_id) ?? [];
    list.push(qualificationName.get(award.qualification_id) ?? "A qualification");
    heldBy.set(award.member_id, list);
  }

  const fleetEvents = rows<Fleet["events"][number]>(events);
  const startOf = new Map(fleetEvents.map((event) => [event.id, Date.parse(event.starts_at)]));
  const fleetReturns = rows<Fleet["returns"][number]>(returns);
  const fleetAttendance = rows<Fleet["attendance"][number]>(attendance);

  const people = rows<Row>(roster).map((row): Person => {
    const id = row.member_id as string;
    const mine = fleetReturns.filter((line) => line.member_id === id);
    const present = mine.filter((line) => line.returned === "present");
    const within = (lines: typeof mine, days: number) =>
      lines.filter((line) => now - (startOf.get(line.event_id) ?? 0) <= days * DAY).length;
    const last = present
      .map((line) => startOf.get(line.event_id) ?? 0)
      .sort((a, b) => b - a)
      .at(0);
    const joinedOn = joined.get(id) ?? "";
    return {
      id,
      name: (row.character_name as string | null) ?? "No name set",
      rsiHandle: row.rsi_handle as string | null,
      discordName: discord.get(id) ?? null,
      status: row.status as Status,
      service: row.service as Service | null,
      gradeCode: row.grade_code as string | null,
      rankName: row.rank_name as string | null,
      acting: row.acting === true,
      postTitle: row.position_title as string | null,
      unitName: row.unit_name as string | null,
      dutyTitle: dutyOf.get(id) ?? null,
      joinedOn,
      daysIn: joinedOn ? Math.max(0, Math.floor((now - Date.parse(joinedOn)) / DAY)) : 0,
      roles: rolesOf.get(id) ?? [],
      qualifications: (heldBy.get(id) ?? []).sort(),
      attended30: within(present, 30),
      attended90: within(present, 90),
      attendedAll: present.length,
      absentWithoutNotice90: within(
        mine.filter((line) => line.returned === "absent_without_notice"),
        90,
      ),
      lastAttended: last ? new Date(last).toISOString() : null,
      standIns: fleetAttendance.filter((line) => line.member_id === id && line.stand_in_position_id).length,
    };
  });
  people.sort((a, b) => a.name.localeCompare(b.name));

  return {
    state: "ready",
    fleet: {
      now,
      stage: (settings.data?.current_stage as number | undefined) ?? 1,
      recruitmentOpen: settings.data?.recruitment_open === true,
      people,
      units: rows<Fleet["units"][number]>(units),
      positions: fleetPositions,
      assignments: fleetAssignments,
      qualifications: fleetQualifications,
      awards: fleetAwards,
      applications: rows<Fleet["applications"][number]>(applications),
      eventTypes: rows<Row>(eventTypes).map((row) => ({ key: row.key as string, name: row.name as string })),
      events: fleetEvents,
      eventUnits: rows<Fleet["eventUnits"][number]>(eventUnits),
      eventKeyPosts: rows<Fleet["eventKeyPosts"][number]>(eventKeyPosts),
      eventPosts: rows<Fleet["eventPosts"][number]>(eventPosts),
      attendance: fleetAttendance,
      returns: fleetReturns,
      reports: rows<Fleet["reports"][number]>(reports),
    },
  };
});

// ---------------------------------------------------------------------------
// Figures. Each takes the loaded fleet and returns what one part of a page shows.
// ---------------------------------------------------------------------------

export type Count = { label: string; value: number };

const count = <T>(items: T[], labels: [string, (item: T) => boolean][]): Count[] =>
  labels.map(([label, test]) => ({ label, value: items.filter(test).length }));

export const statusNames: Record<Status, string> = {
  applicant: "Applicant",
  recruit: "Recruit",
  auxiliary: "Auxiliary",
  member: "Full member",
  reserve: "Reserve",
  discharged: "Discharged",
};
export const serviceNames: Record<Service, string> = { navy: "Navy", army: "Army", marines: "Marines" };

export function strength(fleet: Fleet) {
  const active = fleet.people.filter((person) => ACTIVE.includes(person.status)).length;
  const serving = fleet.people.filter((person) => SERVING.includes(person.status)).length;
  const band = stages.find((entry) => entry.stage === fleet.stage) ?? stages[0];
  const next = stages.find((entry) => entry.stage === fleet.stage + 1) ?? null;
  // The stage this strength would support, whatever stage the fleet is at.
  const supports = [...stages].reverse().find((entry) => active >= entry.from) ?? null;
  return { active, serving, band, next, supports };
}

export function byStatus(fleet: Fleet): Count[] {
  return (Object.keys(statusNames) as Status[]).map((status) => ({
    label: statusNames[status],
    value: fleet.people.filter((person) => person.status === status).length,
  }));
}

export function byService(fleet: Fleet): Count[] {
  const serving = fleet.people.filter((person) => SERVING.includes(person.status));
  return [
    ...(Object.keys(serviceNames) as Service[]).map((service) => ({
      label: serviceNames[service],
      value: serving.filter((person) => person.service === service).length,
    })),
    { label: "Not set", value: serving.filter((person) => !person.service).length },
  ].filter((entry) => entry.value > 0 || entry.label !== "Not set");
}

/** Serving members by where their grade sits on the ladder. */
export function byBand(fleet: Fleet): Count[] {
  const serving = fleet.people.filter((person) => SERVING.includes(person.status));
  const grade = (person: Person) => person.gradeCode ?? "";
  return count(serving, [
    ["E1 to E3", (person) => /^E[1-3]$/.test(grade(person))],
    ["E4 to E7", (person) => /^E[4-7]$/.test(grade(person))],
    ["Cadet", (person) => grade(person) === "OC"],
    ["O1 to O3", (person) => /^O[1-3]$/.test(grade(person))],
    ["O4 and above", (person) => /^O([4-9]|10)$/.test(grade(person))],
    ["No grade", (person) => grade(person) === ""],
  ]);
}

/** The stage at which a unit opens: no earlier than any unit above it. */
function unitOpensAt(fleet: Fleet) {
  const byId = new Map(fleet.units.map((unit) => [unit.id, unit]));
  const known = new Map<string, number>();
  const opensAt = (id: string, depth = 0): number => {
    const cached = known.get(id);
    if (cached !== undefined) return cached;
    const unit = byId.get(id);
    if (!unit) return 1;
    const above = unit.parent_id && depth < 12 ? opensAt(unit.parent_id, depth + 1) : 1;
    const value = Math.max(unit.opens_at_stage, above);
    known.set(id, value);
    return value;
  };
  return opensAt;
}

export type PostFigures = {
  open: number;
  filled: number;
  vacant: number;
  later: number;
  entryVacant: number;
  /** Open posts and how many are filled, for each unit that has posts of its own. */
  units: { name: string; open: number; filled: number; opensAtStage: number }[];
  dutiesOpen: number;
  dutiesHeld: number;
};

export function posts(fleet: Fleet): PostFigures {
  const opensAt = unitOpensAt(fleet);
  const held = new Set(fleet.assignments.filter((entry) => !entry.ended_on).map((entry) => entry.position_id));
  const figures: PostFigures = { open: 0, filled: 0, vacant: 0, later: 0, entryVacant: 0, units: [], dutiesOpen: 0, dutiesHeld: 0 };
  const perUnit = new Map<string, { name: string; open: number; filled: number; opensAtStage: number }>();

  for (const position of fleet.positions) {
    const stage = Math.max(position.opens_at_stage, opensAt(position.unit_id));
    const isOpen = stage <= fleet.stage;
    if (position.kind === "duty") {
      if (isOpen) figures.dutiesOpen += 1;
      if (held.has(position.id)) figures.dutiesHeld += 1;
      continue;
    }
    const unit = fleet.units.find((entry) => entry.id === position.unit_id);
    const line = perUnit.get(position.unit_id) ?? { name: unit?.name ?? "A unit", open: 0, filled: 0, opensAtStage: opensAt(position.unit_id) };
    perUnit.set(position.unit_id, line);
    if (!isOpen) {
      figures.later += 1;
      continue;
    }
    figures.open += 1;
    line.open += 1;
    if (held.has(position.id)) {
      figures.filled += 1;
      line.filled += 1;
    } else {
      figures.vacant += 1;
      if (position.is_entry) figures.entryVacant += 1;
    }
  }
  figures.units = [...perUnit.values()].filter((line) => line.open > 0);
  return figures;
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The start of the week a moment falls in: Monday, in UTC. */
function weekStart(at: number): number {
  const day = new Date(at);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - sinceMonday);
}

export type Series = { label: string; long: string; value: number }[];

const shortDate = (at: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(at));

/** How many things fell in each of the last so-many weeks, oldest first. */
function perWeek(moments: number[], weeks: number, now: number): Series {
  const thisWeek = weekStart(now);
  return Array.from({ length: weeks }, (_, index) => {
    const from = thisWeek - (weeks - 1 - index) * 7 * DAY;
    return {
      label: shortDate(from),
      long: `Week of ${shortDate(from)}`,
      value: moments.filter((at) => at >= from && at < from + 7 * DAY).length,
    };
  });
}

export function recruiting(fleet: Fleet) {
  const { applications, now } = fleet;
  const name = new Map(fleet.people.map((person) => [person.id, person.name]));
  const open = applications.filter((entry) => entry.stage === "submitted" || entry.stage === "interview");
  const decided = applications.filter((entry) => entry.stage === "accepted" || entry.stage === "declined");
  const accepted = applications.filter((entry) => entry.stage === "accepted");
  const daysToDecide = decided
    .filter((entry) => entry.decided_at)
    .map((entry) => (Date.parse(entry.decided_at!) - Date.parse(entry.submitted_at)) / DAY);
  const recent = (days: number) => applications.filter((entry) => now - Date.parse(entry.submitted_at) <= days * DAY);
  const applicants = new Set(applications.map((entry) => entry.member_id));

  return {
    total: applications.length,
    applicants: applicants.size,
    repeat: [...applicants].filter((id) => applications.filter((entry) => entry.member_id === id).length > 1).length,
    last30: recent(30).length,
    waiting: applications.filter((entry) => entry.stage === "submitted").length,
    atInterview: applications.filter((entry) => entry.stage === "interview").length,
    // The stages in order, each counting everyone who got at least that far.
    funnel: [
      { label: "Applied", value: applications.length },
      {
        label: "Reached interview or a decision",
        value: applications.filter((entry) => entry.stage !== "submitted" && entry.stage !== "withdrawn").length,
      },
      { label: "Accepted", value: accepted.length },
    ] satisfies Count[],
    outcomes: count(applications, [
      ["Waiting to be read", (entry) => entry.stage === "submitted"],
      ["At interview", (entry) => entry.stage === "interview"],
      ["Accepted", (entry) => entry.stage === "accepted"],
      ["Declined", (entry) => entry.stage === "declined"],
      ["Withdrawn", (entry) => entry.stage === "withdrawn"],
    ]),
    acceptanceRate: decided.length > 0 ? accepted.length / decided.length : null,
    medianDaysToDecide: median(daysToDecide),
    byService: (Object.keys(serviceNames) as Service[])
      .map((service) => ({ label: serviceNames[service], value: applications.filter((entry) => entry.preferred_service === service).length }))
      .filter((entry) => entry.value > 0),
    byRoute: count(applications, [
      ["Recruit", (entry) => entry.route === "recruit"],
      ["Cadet", (entry) => entry.route === "cadet"],
    ]),
    perWeek: perWeek(
      applications.map((entry) => Date.parse(entry.submitted_at)),
      8,
      now,
    ),
    open: open
      .map((entry) => ({
        id: entry.id,
        name: name.get(entry.member_id) ?? "No name set",
        stage: entry.stage,
        submittedAt: entry.submitted_at,
        daysWaiting: Math.floor((now - Date.parse(entry.submitted_at)) / DAY),
      }))
      .sort((a, b) => b.daysWaiting - a.daysWaiting),
  };
}

export type EventFigures = {
  id: string;
  title: string;
  /** What its type is called. */
  kindName: string;
  state: EventState;
  startsAt: string;
  commander: string;
  attending: number;
  notAttending: number;
  standIns: number;
  present: number;
  absentWithNotice: number;
  absentWithoutNotice: number;
  /** Filed in time, late, overdue, or not due yet. Null for an event that never ran. */
  report: "on time" | "late" | "overdue" | "not due" | null;
  /** Whether it has the people it needs. Null unless it is announced and sets a minimum or marks a post. */
  manning: Manning | null;
};

export function operations(fleet: Fleet) {
  const { events, now } = fleet;
  const name = new Map(fleet.people.map((person) => [person.id, person.name]));
  const filed = new Map(fleet.reports.map((report) => [report.event_id, Date.parse(report.filed_at)]));
  const typeName = new Map(fleet.eventTypes.map((type) => [type.key, type.name]));
  const positionTitle = new Map(fleet.positions.map((position) => [position.id, position.title]));
  // Who holds each primary post now.
  const holderOf = new Map(
    fleet.assignments.filter((entry) => entry.kind === "primary" && !entry.ended_on).map((entry) => [entry.position_id, entry.member_id]),
  );
  const allUnits = fleet.units.map((unit) => ({ id: unit.id, parentId: unit.parent_id }));
  /** The posts that take part in an event: all of them, unless it names its units. */
  const takingPart = (eventId: string) => {
    const taking = unitsTakingPart(
      allUnits,
      fleet.eventUnits.filter((entry) => entry.event_id === eventId).map((entry) => entry.unit_id),
    );
    return new Set(fleet.positions.filter((position) => !taking || taking.has(position.unit_id)).map((position) => position.id));
  };

  const figures = events.map((event): EventFigures => {
    const lines = fleet.attendance.filter((line) => line.event_id === event.id);
    const marks = fleet.returns.filter((line) => line.event_id === event.id);
    const starts = Date.parse(event.starts_at);
    const reportAt = filed.get(event.id);
    const ran = event.state === "done" || (event.state === "announced" && starts <= now);
    const part = takingPart(event.id);
    const manning =
      event.state === "announced" && starts > now
        ? manningOf({
            minimum: event.minimum_attending,
            keyPosts: fleet.eventKeyPosts
              .filter((entry) => entry.event_id === event.id && part.has(entry.position_id))
              .map((entry) => ({
                id: entry.position_id,
                title: positionTitle.get(entry.position_id) ?? "A post",
                holderId: holderOf.get(entry.position_id) ?? null,
              })),
            extraPosts: fleet.eventPosts.filter((post) => post.event_id === event.id).map((post) => ({ id: post.id, title: post.title, mustFill: post.must_fill })),
            lines: lines.map((line) => ({
              memberId: line.member_id,
              reply: line.reply,
              place: line.place,
              standInFor: line.stand_in_position_id,
              extraPost: line.event_post_id,
              repliedAt: line.replied_at,
            })),
            rollOpen: event.roll_closes_at !== null && now < Date.parse(event.roll_closes_at),
          })
        : null;
    return {
      id: event.id,
      title: event.title,
      kindName: typeName.get(event.kind) ?? event.kind,
      state: event.state,
      startsAt: event.starts_at,
      commander: event.commander_id ? (name.get(event.commander_id) ?? "A member") : "Not named",
      attending: lines.filter((line) => line.reply === "attending").length,
      notAttending: lines.filter((line) => line.reply === "not_attending").length,
      standIns: lines.filter((line) => line.stand_in_position_id || line.event_post_id).length,
      manning,
      present: marks.filter((line) => line.returned === "present").length,
      absentWithNotice: marks.filter((line) => line.returned === "absent_with_notice").length,
      absentWithoutNotice: marks.filter((line) => line.returned === "absent_without_notice").length,
      // The report is due within 48 hours of the start.
      report: !ran
        ? null
        : reportAt !== undefined
          ? reportAt - starts <= 2 * DAY
            ? "on time"
            : "late"
          : now - starts > 2 * DAY
            ? "overdue"
            : "not due",
    };
  });

  const done = figures.filter((event) => event.state === "done");
  const turnout = done.filter((event) => event.attending > 0).map((event) => event.present / event.attending);
  const upcoming = figures.filter((event) => event.state === "announced" && Date.parse(event.startsAt) > now);

  // Who has not replied to an event that is coming up: holders of the posts that take part in it.
  const outstanding = upcoming.map((event) => {
    const replied = new Set(fleet.attendance.filter((line) => line.event_id === event.id && line.reply).map((line) => line.member_id));
    const part = takingPart(event.id);
    const holders = new Set([...holderOf].filter(([position]) => part.has(position)).map(([, member]) => member));
    return {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      waitingOn: [...holders].filter((id) => !replied.has(id)).map((id) => name.get(id) ?? "A member").sort(),
    };
  });

  return {
    events: figures,
    upcoming,
    outstanding,
    drafts: figures.filter((event) => event.state === "draft").length,
    held: done.length,
    cancelled: figures.filter((event) => event.state === "cancelled").length,
    last30: done.filter((event) => now - Date.parse(event.startsAt) <= 30 * DAY).length,
    averageTurnout: turnout.length > 0 ? turnout.reduce((sum, value) => sum + value, 0) / turnout.length : null,
    reportsOnTime: done.filter((event) => event.report === "on time").length,
    reportsLate: done.filter((event) => event.report === "late").length,
    reportsOverdue: figures.filter((event) => event.report === "overdue").length,
    // Every type the fleet has, so one with no events yet still has its row.
    byKind: fleet.eventTypes.map((type) => ({
      name: type.name,
      value: events.filter((event) => event.kind === type.key && event.state !== "draft" && event.state !== "cancelled").length,
    })),
    perWeek: perWeek(
      done.map((event) => Date.parse(event.startsAt)),
      8,
      now,
    ),
  };
}

export type Attention = { what: string; detail: string; href: string | null };

/** The things someone should look at, most pressing first. */
export function attention(fleet: Fleet, tier: Tier): Attention[] {
  const list: Attention[] = [];
  const { now } = fleet;
  const applications = recruiting(fleet);
  for (const entry of applications.open.filter((application) => application.daysWaiting >= 7)) {
    list.push({
      what: `${entry.name}'s application has waited ${entry.daysWaiting} days`,
      detail: entry.stage === "interview" ? "At interview." : "Not read yet.",
      href: `/staff/applications/${entry.id}`,
    });
  }

  // An acting appointment lasts up to 60 days, then is confirmed, extended once or ended.
  const name = new Map(fleet.people.map((person) => [person.id, person.name]));
  const title = new Map(fleet.positions.map((position) => [position.id, position.title]));
  for (const assignment of fleet.assignments) {
    if (!assignment.acting || assignment.ended_on) continue;
    const days = Math.floor((now - Date.parse(assignment.started_on)) / DAY);
    if (days > 60) {
      list.push({
        what: `${name.get(assignment.member_id) ?? "A member"} has been acting ${title.get(assignment.position_id) ?? "in a post"} for ${days} days`,
        detail: "An acting appointment lasts up to 60 days, then is confirmed, extended once or ended.",
        href: "/order-of-battle",
      });
    }
  }

  for (const person of fleet.people) {
    if (person.status === "member" && !person.postTitle) {
      list.push({ what: `${person.name} is a full member with no post`, detail: "Every member holds one primary post.", href: "/admin/people" });
    }
  }

  if (reaches(tier, "command")) {
    const figures = operations(fleet);
    for (const event of figures.events) {
      const starts = Date.parse(event.startsAt);
      if (event.state === "announced" && starts < now) {
        list.push({
          what: `${event.title} has started and is not closed`,
          detail: "Whoever ran it makes the attendance return, which closes it.",
          href: `/operations/${event.id}`,
        });
      }
      // The roll has closed and it does not have what it needs. Whether it goes ahead is the commander's decision.
      if (event.manning?.state === "no-go") {
        list.push({
          what: `${event.title} is below its minimum manning`,
          detail: shortfall(event.manning),
          href: `/operations/${event.id}`,
        });
      }
      if (event.report === "overdue") {
        list.push({
          what: `${event.title} has no after-action report`,
          detail: "The report is due within 48 hours of the start.",
          href: `/operations/${event.id}`,
        });
      }
    }
    for (const event of figures.outstanding) {
      if (event.waitingOn.length > 0) {
        list.push({
          what: `${event.title}: ${event.waitingOn.length} post ${event.waitingOn.length === 1 ? "holder has" : "holders have"} not replied`,
          detail: event.waitingOn.join(", "),
          href: `/operations/${event.id}`,
        });
      }
    }
  }
  return list;
}

/** How many members hold each qualification. */
export function qualificationHolders(fleet: Fleet): Count[] {
  const serving = new Set(fleet.people.filter((person) => SERVING.includes(person.status)).map((person) => person.id));
  return fleet.qualifications
    .map((qualification) => ({
      label: qualification.name,
      value: fleet.awards.filter((award) => award.qualification_id === qualification.id && serving.has(award.member_id)).length,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/**
 * How many applications were accepted in each of the last six months, oldest
 * first. Accepting an application is what makes someone a recruit.
 */
export function joiners(fleet: Fleet): Series {
  const today = new Date(fleet.now);
  const accepted = fleet.applications.filter((entry) => entry.stage === "accepted" && entry.decided_at);
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (5 - index), 1));
    const key = month.toISOString().slice(0, 7);
    return {
      label: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(month),
      long: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(month),
      value: accepted.filter((entry) => new Date(entry.decided_at!).toISOString().startsWith(key)).length,
    };
  });
}

/** Acting appointments, the longest first. */
export function acting(fleet: Fleet) {
  const name = new Map(fleet.people.map((person) => [person.id, person.name]));
  const title = new Map(fleet.positions.map((position) => [position.id, position.title]));
  return fleet.assignments
    .filter((assignment) => assignment.acting && !assignment.ended_on)
    .map((assignment) => ({
      id: assignment.id,
      name: name.get(assignment.member_id) ?? "A member",
      post: title.get(assignment.position_id) ?? "A post",
      days: Math.floor((fleet.now - Date.parse(assignment.started_on)) / DAY),
    }))
    .sort((a, b) => b.days - a.days);
}
