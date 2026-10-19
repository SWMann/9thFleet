import "server-only";
import { getSession, isServing, type Member, type Status } from "@/lib/member";
import { createClient } from "@/lib/supabase/server";

/**
 * The lessons log: what each after-action report said to keep and to change,
 * across every event, latest first. Read as the member asking: the database
 * sends the reports of the events they can see, which for the serving fleet
 * is all of them.
 */

export type Lesson = {
  event: { id: string; title: string; type: string; typeKey: string; startsAt: string };
  author: string | null;
  filedAt: string;
  toKeep: string;
  toChange: string;
};

export type LessonsLog =
  | { state: "no-database" }
  | { state: "signed-out" }
  | { state: "no-record" }
  | { state: "outside" }
  | {
      state: "ready";
      member: Member;
      lessons: Lesson[];
      /** The event types with lessons, for narrowing the list. */
      types: { key: string; name: string; count: number }[];
      /** Character names by member id, so a mention reads as a name. */
      memberNames: Record<string, string>;
    };

type Row = Record<string, unknown>;
const SERVING: Status[] = ["recruit", "auxiliary", "member", "reserve"];
const PAGE = 1000;

export async function getLessonsLog(): Promise<LessonsLog> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  if (!isServing(session.member)) return { state: "outside" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  // The latest reports. Those with nothing to keep or change are not lessons, and are left out below.
  const [reports, types, roster] = await Promise.all([
    supabase.from("after_action_reports").select("event_id, author_id, to_keep, to_change, filed_at").order("filed_at", { ascending: false }).range(0, PAGE - 1),
    supabase.from("event_types").select("key, name"),
    supabase.from("roster").select("member_id, character_name, rank_name, acting, status"),
  ]);
  for (const result of [reports, types, roster]) {
    if (result.error) throw new Error(`The lessons log could not be read: ${result.error.message}`);
  }
  const reportRows = ((reports.data ?? []) as Row[]).filter((row) => (row.to_keep as string) || (row.to_change as string));
  const eventIds = reportRows.map((row) => row.event_id as string);
  const events = eventIds.length > 0 ? await supabase.from("events").select("id, title, kind, starts_at").in("id", eventIds) : { data: [], error: null };
  if (events.error) throw new Error(`The lessons log could not be read: ${events.error.message}`);
  const typeName = new Map(((types.data ?? []) as Row[]).map((row) => [row.key as string, row.name as string]));
  const eventOf = new Map(((events.data ?? []) as Row[]).map((row) => [row.id as string, row]));
  const names: Record<string, string> = {};
  const fullNames: Record<string, string> = {};
  for (const row of (roster.data ?? []) as Row[]) {
    if (!row.character_name) continue;
    if (SERVING.includes(row.status as Status)) names[row.member_id as string] = row.character_name as string;
    fullNames[row.member_id as string] = row.rank_name ? `${row.acting === true ? "Acting " : ""}${row.rank_name} ${row.character_name}` : (row.character_name as string);
  }

  const lessons: Lesson[] = reportRows
    .map((row) => {
      const event = eventOf.get(row.event_id as string);
      if (!event) return null;
      return {
        event: { id: event.id as string, title: event.title as string, type: typeName.get(event.kind as string) ?? "Event", typeKey: event.kind as string, startsAt: event.starts_at as string },
        author: row.author_id ? (fullNames[row.author_id as string] ?? "a former member") : null,
        filedAt: row.filed_at as string,
        toKeep: (row.to_keep as string) ?? "",
        toChange: (row.to_change as string) ?? "",
      };
    })
    .filter((lesson): lesson is Lesson => lesson !== null)
    .sort((a, b) => b.event.startsAt.localeCompare(a.event.startsAt));
  const counts = new Map<string, number>();
  for (const lesson of lessons) counts.set(lesson.event.typeKey, (counts.get(lesson.event.typeKey) ?? 0) + 1);

  return {
    state: "ready",
    member: session.member,
    lessons,
    types: [...counts.entries()].map(([key, count]) => ({ key, name: typeName.get(key) ?? key, count })).sort((a, b) => a.name.localeCompare(b.name)),
    memberNames: names,
  };
}
