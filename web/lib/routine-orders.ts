import "server-only";
import { gradeChanges, type GradeLine, type PostHeld } from "@/lib/record";
import { getSession, isServing, type Member, type Status } from "@/lib/member";
import { composeRoutineOrders, sinceIssue, type Named, type OrderParts, type OrderState } from "@/lib/orders-form";
import { fleetSources } from "@/lib/rich/offer";
import type { RichSources } from "@/lib/rich/sources";
import { createClient } from "@/lib/supabase/server";

/**
 * Routine orders, read as the member asking. The database sends issued orders
 * to the serving fleet, and the draft to command alone. Who has read an issue
 * is sent to command, and to each member for their own line.
 */

export type Issue = {
  id: string;
  number: number | null;
  title: string;
  state: OrderState;
  body: string;
  coversFrom: string;
  coversTo: string;
  draftedBy: string | null;
  draftedAt: string;
  issuedBy: string | null;
  issuedAt: string | null;
  updatedAt: string;
  /** Whether the reader has marked it as read. */
  read: boolean;
};

type Row = Record<string, unknown>;
const COLUMNS = "id, number, title, state, body, covers_from, covers_to, drafted_by, drafted_at, issued_by, issued_at, updated_at";
const SERVING: Status[] = ["recruit", "auxiliary", "member", "reserve"];

const toIssue = (row: Row, read: boolean): Issue => ({
  id: row.id as string,
  number: (row.number as number | null) ?? null,
  title: (row.title as string) ?? "",
  state: row.state as OrderState,
  body: (row.body as string) ?? "",
  coversFrom: row.covers_from as string,
  coversTo: row.covers_to as string,
  draftedBy: (row.drafted_by as string | null) ?? null,
  draftedAt: row.drafted_at as string,
  issuedBy: (row.issued_by as string | null) ?? null,
  issuedAt: (row.issued_at as string | null) ?? null,
  updatedAt: row.updated_at as string,
  read,
});

type Outside = { state: "no-database" } | { state: "signed-out" } | { state: "no-record" } | { state: "outside" };

async function reader(): Promise<Outside | { state: "ready"; member: Member; command: boolean }> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  if (!isServing(session.member)) return { state: "outside" };
  return { state: "ready", member: session.member, command: session.member.roles.some((role) => role === "command" || role === "admin") };
}

/** Each serving member's name, by id, as the fleet's records give it. */
async function fleetNames(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>): Promise<{ names: Record<string, string>; serving: Named[] }> {
  const roster = await supabase.from("roster").select("member_id, character_name, rank_name, acting, status");
  if (roster.error) throw new Error(`The fleet could not be read: ${roster.error.message}`);
  const names: Record<string, string> = {};
  const serving: Named[] = [];
  for (const row of (roster.data ?? []) as Row[]) {
    if (!row.character_name) continue;
    const name = row.rank_name ? `${row.acting === true ? "Acting " : ""}${row.rank_name} ${row.character_name}` : (row.character_name as string);
    names[row.member_id as string] = name;
    if (SERVING.includes(row.status as Status)) serving.push({ id: row.member_id as string, name });
  }
  return { names, serving: serving.sort((a, b) => a.name.localeCompare(b.name)) };
}

export type OrdersList =
  | Outside
  | {
      state: "ready";
      member: Member;
      command: boolean;
      /** Issued, the latest first. */
      issues: Issue[];
      /** Command's draft, if there is one. */
      draft: Issue | null;
      /** How many of the serving fleet have read each issue, for command. */
      readBy: Record<string, number>;
      serving: number;
      /** Days since the last issue, and whether the next is due. */
      since: ReturnType<typeof sinceIssue>;
      names: Record<string, string>;
    };

export async function getRoutineOrders(): Promise<OrdersList> {
  const who = await reader();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [orders, reads, fleet] = await Promise.all([
    supabase.from("routine_orders").select(COLUMNS),
    supabase.from("routine_order_reads").select("order_id, member_id"),
    fleetNames(supabase),
  ]);
  for (const result of [orders, reads]) {
    if (result.error) throw new Error(`The routine orders could not be read: ${result.error.message}`);
  }
  const me = who.member.id;
  const mine = new Set(((reads.data ?? []) as Row[]).filter((row) => row.member_id === me).map((row) => row.order_id as string));
  const readBy: Record<string, number> = {};
  for (const row of (reads.data ?? []) as Row[]) readBy[row.order_id as string] = (readBy[row.order_id as string] ?? 0) + 1;

  const all = ((orders.data ?? []) as Row[]).map((row) => toIssue(row, mine.has(row.id as string)));
  const issues = all.filter((issue) => issue.state === "issued").sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  return {
    state: "ready",
    member: who.member,
    command: who.command,
    issues,
    draft: all.find((issue) => issue.state === "draft") ?? null,
    readBy,
    serving: fleet.serving.length,
    since: sinceIssue(issues[0]?.issuedAt ?? null, Date.now()),
    names: fleet.names,
  };
}

export type OneIssue =
  | Outside
  | { state: "not-found" }
  | {
      state: "ready";
      member: Member;
      command: boolean;
      issue: Issue;
      /** For command: who has read it, and who serving has not. */
      readers: { read: Named[]; unread: Named[] } | null;
      names: Record<string, string>;
      sources: RichSources;
    };

/** One issue by its number, or the draft when `number` is "draft". */
export async function getRoutineOrder(number: string): Promise<OneIssue> {
  const who = await reader();
  if (who.state !== "ready") return who;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const wanted = number === "draft" ? supabase.from("routine_orders").select(COLUMNS).eq("state", "draft") : /^\d{1,6}$/.test(number) ? supabase.from("routine_orders").select(COLUMNS).eq("number", Number(number)) : null;
  if (!wanted) return { state: "not-found" };
  const found = await wanted.maybeSingle();
  if (found.error) throw new Error(`The routine orders could not be read: ${found.error.message}`);
  if (!found.data) return { state: "not-found" };
  const row = found.data as Row;

  const [reads, fleet, sources] = await Promise.all([
    supabase.from("routine_order_reads").select("member_id").eq("order_id", row.id as string),
    fleetNames(supabase),
    fleetSources(),
  ]);
  if (reads.error) throw new Error(`The routine orders could not be read: ${reads.error.message}`);
  const readIds = new Set(((reads.data ?? []) as Row[]).map((entry) => entry.member_id as string));
  const issue = toIssue(row, readIds.has(who.member.id));
  return {
    state: "ready",
    member: who.member,
    command: who.command,
    issue,
    readers:
      who.command && issue.state === "issued"
        ? { read: fleet.serving.filter((person) => readIds.has(person.id)), unread: fleet.serving.filter((person) => !readIds.has(person.id)) }
        : null,
    names: fleet.names,
    sources,
  };
}

/** The issues the reader has not marked as read, for the notices on their pages. Nothing for anyone not serving. */
export async function getUnreadOrders(): Promise<{ count: number; latest: { number: number; title: string } | null }> {
  const none = { count: 0, latest: null };
  const who = await reader();
  if (who.state !== "ready") return none;
  const supabase = await createClient();
  if (!supabase) return none;
  const [orders, reads] = await Promise.all([
    supabase.from("routine_orders").select("id, number, title").eq("state", "issued").order("number", { ascending: false }),
    supabase.from("routine_order_reads").select("order_id").eq("member_id", who.member.id),
  ]);
  if (orders.error || reads.error) throw new Error(`The routine orders could not be read: ${(orders.error ?? reads.error)?.message}`);
  const read = new Set(((reads.data ?? []) as Row[]).map((row) => row.order_id as string));
  const unread = ((orders.data ?? []) as Row[]).filter((row) => !read.has(row.id as string));
  return { count: unread.length, latest: unread.length > 0 ? { number: unread[0].number as number, title: (unread[0].title as string) ?? "" } : null };
}

/**
 * The record of a period, gathered as the member asking and written as the
 * draft of an issue. Everything is read as command, so the database sends the
 * whole fleet's record. Dates are compared as days in UTC, timestamps as they
 * are: a line dated on the day the last issue was drafted, but recorded after
 * it, is not missed where the database keeps the time it was recorded.
 */
export async function draftFromRecord(coversFrom: string, coversTo: string, firstIssue: boolean): Promise<string> {
  const supabase = await createClient();
  if (!supabase) throw new Error("This site is not connected to the database yet.");
  const fromDay = coversFrom.slice(0, 10);
  const toDay = coversTo.slice(0, 10);
  const from = Date.parse(coversFrom);
  const to = Date.parse(coversTo);
  const inDays = (day: string) => (firstIssue ? day >= fromDay : day > fromDay) && day <= toDay;
  const inTime = (at: string) => {
    const t = Date.parse(at);
    return (firstIssue ? t >= from : t > from) && t <= to;
  };
  const ahead = new Date(to + 14 * 24 * 60 * 60 * 1000).toISOString();

  const [fleet, assignments, positions, units, gradeLines, grades, ranks, roster, awards, qualifications, statuses, events, types, returns, hostiles, settings] =
    await Promise.all([
      fleetNames(supabase),
      supabase.from("assignments").select("id, member_id, position_id, kind, grade_code, acting, started_on, ended_on"),
      supabase.from("positions").select("id, unit_id, title"),
      supabase.from("units").select("id, name"),
      supabase.from("assignment_grades").select("id, assignment_id, member_id, grade_code, acting, since, recorded_at"),
      supabase.from("grades").select("code, sort_order"),
      supabase.from("ranks").select("grade_code, service, name"),
      supabase.from("roster").select("member_id, service, status"),
      supabase.from("qualification_awards").select("member_id, qualification_id, awarded_on"),
      supabase.from("qualifications").select("id, name"),
      supabase.from("member_status_changes").select("member_id, status, changed_on, recorded_at"),
      supabase.from("events").select("id, title, kind, starts_at, state").gte("starts_at", new Date(from - 60 * 24 * 60 * 60 * 1000).toISOString()).lte("starts_at", ahead),
      supabase.from("event_types").select("key, name"),
      supabase.from("attendance_returns").select("event_id, returned"),
      supabase.from("hostiles").select("handle, kind, level, state, decided_at, lifted_at"),
      supabase.from("fleet_settings").select("current_stage").maybeSingle(),
    ]);
  for (const result of [assignments, positions, units, gradeLines, grades, ranks, roster, awards, qualifications, statuses, events, types, returns, hostiles, settings]) {
    if (result.error) throw new Error(`The fleet's record could not be read: ${result.error.message}`);
  }
  const rows = (result: { data: unknown }) => (result.data ?? []) as Row[];
  const named = (id: string): Named => ({ id, name: fleet.names[id] ?? "a former member" });
  const unitName = new Map(rows(units).map((row) => [row.id as string, row.name as string]));
  const positionOf = new Map(rows(positions).map((row) => [row.id as string, { title: row.title as string, unit: unitName.get(row.unit_id as string) ?? "" }]));
  const serviceOf = new Map(rows(roster).map((row) => [row.member_id as string, row.service as string | null]));
  const rankName = (grade: string, memberId: string) =>
    (rows(ranks).find((row) => row.grade_code === grade && row.service === serviceOf.get(memberId))?.name as string | undefined) ?? grade;
  const order = new Map(rows(grades).map((row) => [row.code as string, Number(row.sort_order)]));

  // Appointments: posts taken up and left in the period.
  const appointments: OrderParts["appointments"] = [];
  for (const row of rows(assignments)) {
    const position = positionOf.get(row.position_id as string) ?? { title: "A post", unit: "" };
    const base = { member: named(row.member_id as string), post: position.title, unit: position.unit, acting: row.acting === true };
    if (inDays(row.started_on as string)) appointments.push({ ...base, on: row.started_on as string, what: "appointed" });
    if (row.ended_on && inDays(row.ended_on as string)) appointments.push({ ...base, on: row.ended_on as string, what: "left" });
  }
  appointments.sort((a, b) => a.on.localeCompare(b.on) || a.member.name.localeCompare(b.member.name));

  // Promotions: each member's grade changes, as the service record works them out, kept where the line was recorded in the period.
  const recorded = new Set(
    rows(gradeLines)
      .filter((row) => inTime(row.recorded_at as string))
      .map((row) => Number(row.id)),
  );
  const changes: OrderParts["grades"] = [];
  const members = [...new Set(rows(gradeLines).filter((row) => recorded.has(Number(row.id))).map((row) => row.member_id as string))];
  for (const memberId of members) {
    const posts: PostHeld[] = rows(assignments)
      .filter((row) => row.member_id === memberId)
      .map((row) => {
        const position = positionOf.get(row.position_id as string);
        return {
          id: row.id as string,
          title: position?.title ?? "A post",
          unit: position?.unit ?? "",
          kind: row.kind as "primary" | "duty",
          acting: row.acting === true,
          gradeCode: (row.grade_code as string | null) ?? null,
          startedOn: row.started_on as string,
          endedOn: (row.ended_on as string | null) ?? null,
        };
      });
    const lines: GradeLine[] = rows(gradeLines)
      .filter((row) => row.member_id === memberId)
      .map((row) => ({ id: Number(row.id), assignmentId: row.assignment_id as string, gradeCode: row.grade_code as string, acting: row.acting === true, since: row.since as string }));
    for (const change of gradeChanges(posts, lines, order)) {
      if (!recorded.has(change.id)) continue;
      const what = change.kind === "promoted" ? "promoted" : change.kind === "reduced" ? "stepped down" : change.kind === "made-acting" ? "acting" : "confirmed";
      changes.push({ member: named(memberId), rank: rankName(change.gradeCode, memberId), grade: change.gradeCode, acting: change.acting, on: change.on, what });
    }
  }
  changes.sort((a, b) => a.on.localeCompare(b.on) || a.member.name.localeCompare(b.member.name));

  const qualificationName = new Map(rows(qualifications).map((row) => [row.id as string, row.name as string]));
  const awarded: OrderParts["qualifications"] = rows(awards)
    .filter((row) => inDays(row.awarded_on as string))
    .map((row) => ({ member: named(row.member_id as string), qualification: qualificationName.get(row.qualification_id as string) ?? "a qualification", on: row.awarded_on as string }))
    .sort((a, b) => a.on.localeCompare(b.on) || a.member.name.localeCompare(b.member.name));

  const moved: OrderParts["statuses"] = rows(statuses)
    .filter((row) => inTime(row.recorded_at as string) && row.status !== "applicant")
    .map((row) => ({ member: named(row.member_id as string), status: row.status as Status, on: row.changed_on as string }))
    .sort((a, b) => a.on.localeCompare(b.on) || a.member.name.localeCompare(b.member.name));

  const typeName = new Map(rows(types).map((row) => [row.key as string, row.name as string]));
  const present = new Map<string, number>();
  for (const row of rows(returns)) {
    if (row.returned === "present") present.set(row.event_id as string, (present.get(row.event_id as string) ?? 0) + 1);
  }
  const eventRows = rows(events).map((row) => ({ id: row.id as string, title: row.title as string, type: typeName.get(row.kind as string) ?? "Event", startsAt: row.starts_at as string, state: row.state as string }));
  const held = eventRows
    .filter((event) => event.state === "done" && inTime(event.startsAt))
    .map((event) => ({ title: event.title, type: event.type, startsAt: event.startsAt, attended: present.get(event.id) ?? 0, href: `/operations/${event.id}` }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const coming = eventRows
    .filter((event) => event.state === "announced" && Date.parse(event.startsAt) > to && event.startsAt <= ahead)
    .map((event) => ({ title: event.title, type: event.type, startsAt: event.startsAt, href: `/operations/${event.id}` }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const listed: OrderParts["hostiles"] = [];
  for (const row of rows(hostiles)) {
    const kind = row.kind as "organisation" | "individual";
    if (row.state === "listed" && row.decided_at && inTime(row.decided_at as string)) {
      listed.push({ handle: row.handle as string, kind, what: row.level === "watch" ? "watch" : "hostile", on: row.decided_at as string });
    }
    if (row.state === "lifted" && row.lifted_at && inTime(row.lifted_at as string)) {
      listed.push({ handle: row.handle as string, kind, what: "lifted", on: row.lifted_at as string });
    }
  }
  listed.sort((a, b) => a.on.localeCompare(b.on) || a.handle.localeCompare(b.handle));

  const count = (status: Status) => rows(roster).filter((row) => row.status === status).length;
  const strength = {
    serving: rows(roster).filter((row) => SERVING.includes(row.status as Status)).length,
    members: count("member"),
    auxiliaries: count("auxiliary"),
    recruits: count("recruit"),
    reserve: count("reserve"),
    stage: Number((settings.data as Row | null)?.current_stage ?? 1),
  };

  return composeRoutineOrders({
    period: { from: coversFrom, to: coversTo },
    appointments,
    grades: changes,
    qualifications: awarded,
    statuses: moved,
    held,
    ahead: coming,
    hostiles: listed,
    strength,
  });
}
