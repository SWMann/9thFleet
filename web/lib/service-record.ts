import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Service } from "@/lib/member";
import type { EventLine, GradeLine, PostHeld, RecordStatus, Returned, StatusLine } from "@/lib/record";

/**
 * A member's service record: the posts they have held, the events they were
 * at, the days their status and grade changed, and what they have earned.
 *
 * It is read as whoever is asking, so the database returns only what they may
 * see. A member reads their own. Staff read anyone's. Anyone else gets an
 * empty record, whatever page asked.
 */

export type ServiceRecord = {
  /** When it was read, which is the "now" every length of time on it is counted to. */
  readAt: number;
  posts: (PostHeld & { note: string })[];
  gradeLines: GradeLine[];
  statusLines: StatusLine[];
  events: EventLine[];
  /** Each grade's place on the ladder, and its rank in the member's service. */
  gradeOrder: Map<string, number>;
  rankNames: Map<string, string>;
  qualifications: { name: string; awardedOn: string; event: { id: string; title: string } | null }[];
  mentions: { citation: string; mentionedAt: string; event: { id: string; title: string } }[];
};

export const emptyRecord = (): ServiceRecord => ({
  readAt: Date.now(),
  posts: [],
  gradeLines: [],
  statusLines: [],
  events: [],
  gradeOrder: new Map(),
  rankNames: new Map(),
  qualifications: [],
  mentions: [],
});

type Row = Record<string, unknown>;

export async function getServiceRecord(memberId: string, service: Service | null): Promise<ServiceRecord> {
  const supabase = await createClient();
  if (!supabase) return emptyRecord();

  const [assignments, positions, units, gradeLines, statusLines, grades, ranks, returns, eventTypes, awards, qualifications, mentions] = await Promise.all([
    supabase.from("assignments").select("id, position_id, kind, grade_code, acting, started_on, ended_on, note").eq("member_id", memberId),
    supabase.from("positions").select("id, unit_id, title"),
    supabase.from("units").select("id, name"),
    supabase.from("assignment_grades").select("id, assignment_id, grade_code, acting, since").eq("member_id", memberId),
    supabase.from("member_status_changes").select("id, status, changed_on").eq("member_id", memberId),
    supabase.from("grades").select("code, sort_order"),
    supabase.from("ranks").select("grade_code, service, name"),
    supabase.from("attendance_returns").select("event_id, returned").eq("member_id", memberId),
    supabase.from("event_types").select("key, name"),
    supabase.from("qualification_awards").select("qualification_id, awarded_on, event_id").eq("member_id", memberId),
    supabase.from("qualifications").select("id, name"),
    supabase.from("event_mentions").select("event_id, citation, mentioned_at").eq("member_id", memberId),
  ]);
  for (const result of [assignments, positions, units, gradeLines, statusLines, grades, ranks, returns, eventTypes, awards, qualifications, mentions]) {
    if (result.error) throw new Error(`The record could not be read: ${result.error.message}`);
  }
  const rows = (result: { data: unknown }) => (result.data ?? []) as Row[];

  const returnRows = rows(returns) as { event_id: string; returned: Returned }[];
  const awardRows = rows(awards) as { qualification_id: string; awarded_on: string; event_id: string | null }[];
  const mentionRows = rows(mentions) as { event_id: string; citation: string; mentioned_at: string }[];

  // The events these point at. One the reader can no longer see is left out, or left without a link.
  const eventIds = [
    ...new Set([...returnRows.map((row) => row.event_id), ...awardRows.map((row) => row.event_id), ...mentionRows.map((row) => row.event_id)].filter((id): id is string => Boolean(id))),
  ];
  const events = eventIds.length > 0 ? await supabase.from("events").select("id, title, starts_at, kind").in("id", eventIds) : { data: [], error: null };
  if (events.error) throw new Error(`The record could not be read: ${events.error.message}`);
  const eventOf = new Map((rows(events) as { id: string; title: string; starts_at: string; kind: string }[]).map((event) => [event.id, event]));
  const typeName = new Map((rows(eventTypes) as { key: string; name: string }[]).map((type) => [type.key, type.name]));

  const unitName = new Map((rows(units) as { id: string; name: string }[]).map((unit) => [unit.id, unit.name]));
  const positionOf = new Map((rows(positions) as { id: string; unit_id: string; title: string }[]).map((position) => [position.id, position]));
  const qualificationName = new Map((rows(qualifications) as { id: string; name: string }[]).map((entry) => [entry.id, entry.name]));

  return {
    readAt: Date.now(),
    posts: (rows(assignments) as { id: string; position_id: string; kind: "primary" | "duty"; grade_code: string | null; acting: boolean; started_on: string; ended_on: string | null; note: string }[]).map((row) => {
      const position = positionOf.get(row.position_id);
      return {
        id: row.id,
        title: position?.title ?? "A post",
        unit: position ? (unitName.get(position.unit_id) ?? "") : "",
        kind: row.kind,
        acting: row.acting === true,
        gradeCode: row.grade_code,
        startedOn: row.started_on,
        endedOn: row.ended_on,
        note: row.note ?? "",
      };
    }),
    gradeLines: (rows(gradeLines) as { id: number; assignment_id: string; grade_code: string; acting: boolean; since: string }[]).map((row) => ({
      id: Number(row.id),
      assignmentId: row.assignment_id,
      gradeCode: row.grade_code,
      acting: row.acting === true,
      since: row.since,
    })),
    statusLines: (rows(statusLines) as { id: number; status: RecordStatus; changed_on: string }[]).map((row) => ({ id: Number(row.id), status: row.status, changedOn: row.changed_on })),
    events: returnRows
      .filter((row) => eventOf.has(row.event_id))
      .map((row) => {
        const event = eventOf.get(row.event_id)!;
        return { id: event.id, title: event.title, startsAt: event.starts_at, type: typeName.get(event.kind) ?? "Event", returned: row.returned };
      })
      // The latest first.
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    gradeOrder: new Map((rows(grades) as { code: string; sort_order: number }[]).map((grade) => [grade.code, grade.sort_order])),
    rankNames: new Map(
      (rows(ranks) as { grade_code: string; service: Service; name: string }[]).filter((rank) => rank.service === (service ?? "navy")).map((rank) => [rank.grade_code, rank.name]),
    ),
    qualifications: awardRows
      .map((row) => {
        const event = row.event_id ? eventOf.get(row.event_id) : undefined;
        return { name: qualificationName.get(row.qualification_id) ?? "A qualification", awardedOn: row.awarded_on, event: event ? { id: event.id, title: event.title } : null };
      })
      .sort((a, b) => a.awardedOn.localeCompare(b.awardedOn) || a.name.localeCompare(b.name)),
    mentions: mentionRows
      .filter((row) => eventOf.has(row.event_id))
      .map((row) => ({ citation: row.citation, mentionedAt: row.mentioned_at, event: { id: row.event_id, title: eventOf.get(row.event_id)!.title } }))
      // The latest first.
      .sort((a, b) => b.mentionedAt.localeCompare(a.mentionedAt)),
  };
}

/** Whose record it is, for the page staff open. */
export type RecordSubject = {
  id: string;
  name: string;
  rsiHandle: string | null;
  discordName: string | null;
  status: RecordStatus;
  service: Service | null;
  gradeCode: string | null;
  rankName: string | null;
  acting: boolean;
  postTitle: string | null;
  unitName: string | null;
  /** The day their record was made: the day they first signed in. */
  joinedOn: string | null;
  roles: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The member a record belongs to, or nothing if there is no such member or the reader may not see them. */
export async function getRecordSubject(memberId: string): Promise<RecordSubject | null> {
  if (!UUID.test(memberId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const [roster, member, account, roles] = await Promise.all([
    supabase
      .from("roster")
      .select("member_id, character_name, rsi_handle, service, status, grade_code, rank_name, acting, position_title, unit_name")
      .eq("member_id", memberId)
      .maybeSingle(),
    supabase.from("members").select("joined_on").eq("id", memberId).maybeSingle(),
    supabase.from("member_accounts").select("discord_name").eq("member_id", memberId).maybeSingle(),
    supabase.from("member_roles").select("role").eq("member_id", memberId),
  ]);
  for (const result of [roster, member, account, roles]) {
    if (result.error) throw new Error(`The record could not be read: ${result.error.message}`);
  }
  if (!roster.data) return null;
  const row = roster.data as Row;
  return {
    id: memberId,
    name: (row.character_name as string | null) ?? "No name set",
    rsiHandle: row.rsi_handle as string | null,
    discordName: (account.data?.discord_name as string | null | undefined) ?? null,
    status: row.status as RecordStatus,
    service: row.service as Service | null,
    gradeCode: row.grade_code as string | null,
    rankName: row.rank_name as string | null,
    acting: row.acting === true,
    postTitle: row.position_title as string | null,
    unitName: row.unit_name as string | null,
    joinedOn: (member.data?.joined_on as string | undefined) ?? null,
    roles: ((roles.data ?? []) as { role: string }[]).map((entry) => entry.role),
  };
}
