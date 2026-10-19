import "server-only";
import { attemptNames, type Attempt } from "@/lib/activity";
import { gate } from "@/lib/admin";
import type { Role, Service, Status } from "@/lib/member";
import { hLabel, outcomeNames, returnedNames, type Outcome, type Returned } from "@/lib/operations-form";
import { plainText } from "@/lib/rich/markdown";
import { createClient } from "@/lib/supabase/server";

/**
 * The Logs page: one list of everything that has happened on the site.
 *
 * It is drawn from two places. The audit log holds every change to a record,
 * with the row before and after. The activity log holds what leaves no record:
 * sign-ins, sign-outs, and anything refused or failed. This file reads both,
 * puts them in order and turns each line into a sentence.
 *
 * Only admins can read either log. That is the database's rule, and the page
 * checks it too.
 */

export type LogKind = "personnel" | "recruiting" | "operations" | "structure" | "records" | "sign-ins" | "refused";

export const kindNames: Record<LogKind, string> = {
  personnel: "Personnel",
  recruiting: "Recruiting",
  operations: "Operations",
  structure: "Structure",
  records: "Records",
  "sign-ins": "Sign-in",
  refused: "Refused",
};

/** What the Show filter offers. Visitors is not a list of lines: it is the page counts. */
export const shows = [
  { key: "all", name: "Everything" },
  { key: "personnel", name: "Personnel actions" },
  { key: "recruiting", name: "Recruiting" },
  { key: "operations", name: "Operations" },
  { key: "structure", name: "Structure and settings" },
  { key: "records", name: "Names and records" },
  { key: "sign-ins", name: "Sign-ins and sign-outs" },
  { key: "refused", name: "Refused and failed" },
  { key: "visitors", name: "Visitors" },
] as const;
export type Show = (typeof shows)[number]["key"];

export const periods = [
  { key: "all", name: "All time", days: null },
  { key: "day", name: "The last 24 hours", days: 1 },
  { key: "week", name: "The last 7 days", days: 7 },
  { key: "month", name: "The last 30 days", days: 30 },
] as const;
export type Period = (typeof periods)[number]["key"];

export type LogLine = {
  key: string;
  at: string;
  kind: LogKind;
  /** The whole line, as a sentence without its full stop. */
  text: string;
  /** More about it: what changed, or what the person was told. */
  detail: string | null;
  /** Set on a line from the activity log that was refused or failed. */
  tone: "refused" | "failed" | null;
};

export type Filters = {
  show: Exclude<Show, "visitors">;
  period: Period;
  /** A member's id: lines they made, or lines about them. */
  member: string | null;
  /** Where the page before this one stopped, in each log. */
  before: { audit: number | null; activity: number | null };
};

export type LogPage =
  | { state: "no-database" }
  | {
      state: "ready";
      lines: LogLine[];
      /** Where the next page starts, or null at the end of the log. */
      older: { audit: number | null; activity: number | null } | null;
      members: { id: string; name: string }[];
    };

const PAGE = 100;

/** The tables whose history belongs to each kind of line. A table can feed more than one. */
const TABLES: Record<Exclude<LogKind, "sign-ins" | "refused">, string[]> = {
  personnel: ["members", "member_roles", "assignments", "qualification_awards", "event_mentions", "lesson_passes", "ships", "ship_notes"],
  recruiting: ["applications", "application_notes", "fleet_settings"],
  operations: [
    "events", "event_orders", "event_units", "event_key_posts", "event_posts", "event_objectives", "event_elements",
    "event_timings", "event_ships", "event_nets", "event_amendments", "event_acknowledgements", "attendance",
    "attendance_returns", "after_action_reports", "event_objective_outcomes", "event_losses", "event_opfor",
    "event_opfor_members", "event_unit_tasks", "hostiles", "piracy_reports", "routine_orders", "event_ship_offers",
  ],
  structure: [
    "areas", "fleet_roles", "fleet_role_qualifications", "units", "positions", "qualifications", "position_qualifications",
    "grades", "ranks", "fleet_settings", "event_types", "lessons", "ship_models", "crew_templates", "crew_template_stations",
  ],
  records: ["members"],
};

/** Who reads a task at each level, as a log line says it. */
const levelWords = {
  everyone: "everyone",
  unit: "the unit",
  leaders: "the unit's leaders",
  commander: "the unit's commander",
} as const;

type Row = Record<string, unknown>;
type AuditRow = {
  id: number;
  at: string;
  actor: string | null;
  subject: string | null;
  table_name: string;
  action: "insert" | "update" | "delete";
  old_row: Row | null;
  new_row: Row | null;
};
type ActivityRow = {
  id: number;
  at: string;
  actor: string;
  kind: "sign_in" | "sign_out" | "refused" | "failed";
  action: string | null;
  shown: string | null;
  cause: string | null;
};

type Names = {
  member: (id: unknown) => string;
  service: (id: unknown) => Service | null;
  post: (id: unknown) => string;
  unit: (id: unknown) => string;
  qualification: (id: unknown) => string;
  /** A lesson, with its course: "Radio check, of General induction". */
  lesson: (id: unknown) => string;
  /** A ship model by id, a ship on the register by id, and a crew template by id. */
  model: (id: unknown) => string;
  ship: (id: unknown) => string;
  template: (id: unknown) => string;
  role: (id: unknown) => string;
  area: (id: unknown) => string;
  event: (id: unknown) => string;
  /** What a type of event is called, from its key. */
  eventType: (key: unknown) => string;
  /** One of an event's own posts. */
  extraPost: (id: unknown) => string;
  /** One of an event's objectives, as it was written. */
  objective: (id: unknown) => string;
  /** Whether the second grade is above the first. Null when either is unknown. */
  higher: (from: unknown, to: unknown) => boolean | null;
  rank: (service: Service | null, grade: unknown) => string;
};

const statusNames: Record<Status, string> = {
  applicant: "Applicant",
  recruit: "Recruit",
  auxiliary: "Auxiliary",
  member: "Full member",
  reserve: "Reserve",
  discharged: "Discharged",
};
const serviceNames: Record<Service, string> = { navy: "Navy", army: "Army", marines: "Marines" };
const roleNames: Record<Role, string> = { instructor: "Instructor", staff: "Staff", command: "Command", admin: "Admin" };
const replyNames: Record<string, string> = { attending: "attending", not_attending: "not attending" };

export async function readLog(filters: Filters): Promise<LogPage> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const days = periods.find((entry) => entry.key === filters.period)?.days ?? null;
  // The page is drawn for one request, so the clock is read once here.
  const since = days ? new Date(new Date().getTime() - days * 24 * 60 * 60 * 1000).toISOString() : null;

  const fromAudit = filters.show !== "sign-ins" && filters.show !== "refused";
  const fromActivity = filters.show === "all" || filters.show === "sign-ins" || filters.show === "refused";

  /** One read of the audit log. With a member chosen it is asked twice: lines they made, and lines about them. */
  const audit = async (column: "actor" | "subject" | null) => {
    let query = supabase
      .from("audit_log")
      .select("id, at, actor, subject, table_name, action, old_row, new_row")
      .order("id", { ascending: false })
      .limit(PAGE + 1);
    if (filters.show !== "all" && filters.show !== "sign-ins" && filters.show !== "refused") {
      query = query.in("table_name", TABLES[filters.show]);
    }
    if (since) query = query.gte("at", since);
    if (filters.before.audit !== null) query = query.lt("id", filters.before.audit);
    if (column && filters.member) query = query.eq(column, filters.member);
    const { data, error } = await query;
    if (error) throw new Error(`The audit log could not be read: ${error.message}`);
    return (data ?? []) as AuditRow[];
  };
  const activity = async () => {
    let query = supabase
      .from("activity_log")
      .select("id, at, actor, kind, action, shown, cause")
      .order("id", { ascending: false })
      .limit(PAGE + 1);
    if (filters.show === "sign-ins") query = query.in("kind", ["sign_in", "sign_out"]);
    if (filters.show === "refused") query = query.in("kind", ["refused", "failed"]);
    if (since) query = query.gte("at", since);
    if (filters.before.activity !== null) query = query.lt("id", filters.before.activity);
    if (filters.member) query = query.eq("actor", filters.member);
    const { data, error } = await query;
    if (error) throw new Error(`The activity log could not be read: ${error.message}`);
    return (data ?? []) as ActivityRow[];
  };

  const [auditRows, activityRows, names] = await Promise.all([
    !fromAudit
      ? Promise.resolve([] as AuditRow[])
      : filters.member
        ? Promise.all([audit("actor"), audit("subject")]).then(([made, about]) => {
            const seen = new Set<number>();
            return [...made, ...about]
              .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
              .sort((a, b) => b.id - a.id)
              .slice(0, PAGE + 1);
          })
        : audit(null),
    fromActivity ? activity() : Promise.resolve([] as ActivityRow[]),
    readNames(supabase),
  ]);

  // Take the newest lines from the two logs in turn. Each log is kept in its
  // own order, so the place the page stops is exact in both.
  const taken: ({ from: "audit"; row: AuditRow } | { from: "activity"; row: ActivityRow })[] = [];
  let a = 0;
  let b = 0;
  while (taken.length < PAGE && (a < auditRows.length || b < activityRows.length)) {
    const next = auditRows[a];
    const other = activityRows[b];
    if (next && (!other || Date.parse(next.at) >= Date.parse(other.at))) {
      taken.push({ from: "audit", row: next });
      a += 1;
    } else {
      taken.push({ from: "activity", row: other });
      b += 1;
    }
  }
  const more = a < auditRows.length || b < activityRows.length;

  const lines = taken
    .map((entry) => (entry.from === "audit" ? describeChange(entry.row, names.names) : describeActivity(entry.row, names.names)))
    .filter((line): line is LogLine => line !== null)
    .filter((line) => filters.show === "all" || line.kind === filters.show);

  return {
    state: "ready",
    lines,
    older: more
      ? {
          audit: a > 0 ? auditRows[a - 1].id : filters.before.audit,
          activity: b > 0 ? activityRows[b - 1].id : filters.before.activity,
        }
      : null,
    members: names.members,
  };
}

/** Everything a line needs to name the people and things it mentions. */
async function readNames(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>) {
  const [members, accounts, positions, units, qualifications, events, grades, ranks, roles, areas, eventTypes, eventPosts, objectives, lessons, models, ships, templates] = await Promise.all([
    supabase.from("members").select("id, character_name, service"),
    supabase.from("member_accounts").select("member_id, discord_name"),
    supabase.from("positions").select("id, title, unit_id"),
    supabase.from("units").select("id, name"),
    supabase.from("qualifications").select("id, name"),
    supabase.from("events").select("id, title"),
    supabase.from("grades").select("code, sort_order"),
    supabase.from("ranks").select("service, grade_code, name"),
    supabase.from("fleet_roles").select("id, name"),
    supabase.from("areas").select("id, name"),
    supabase.from("event_types").select("key, name"),
    supabase.from("event_posts").select("id, title"),
    supabase.from("event_objectives").select("id, title"),
    supabase.from("lessons").select("id, name, qualification_id"),
    supabase.from("ship_models").select("id, name"),
    supabase.from("ships").select("id, model_id, name, owner_id"),
    supabase.from("crew_templates").select("id, model_id, name"),
  ]);
  for (const result of [members, accounts, positions, units, qualifications, events, grades, ranks, roles, areas, eventTypes, eventPosts, objectives, lessons, models, ships, templates]) {
    if (result.error) throw new Error(`The names for the log could not be read: ${result.error.message}`);
  }

  const discord = new Map((accounts.data ?? []).map((row) => [row.member_id as string, row.discord_name as string | null]));
  const memberName = new Map<string, string>();
  const memberService = new Map<string, Service | null>();
  for (const row of members.data ?? []) {
    const id = row.id as string;
    const known = (row.character_name as string | null) ?? discord.get(id) ?? null;
    memberName.set(id, known ?? "Someone with no name set");
    memberService.set(id, row.service as Service | null);
  }
  const unitName = new Map((units.data ?? []).map((row) => [row.id as string, row.name as string]));
  const postName = new Map(
    (positions.data ?? []).map((row) => [row.id as string, `${row.title}, ${unitName.get(row.unit_id as string) ?? "a unit"}`]),
  );
  const qualificationName = new Map((qualifications.data ?? []).map((row) => [row.id as string, row.name as string]));
  const lessonName = new Map((lessons.data ?? []).map((row) => [row.id as string, `${row.name}, of ${qualificationName.get(row.qualification_id as string) ?? "a course that is gone"}`]));
  const modelName = new Map((models.data ?? []).map((row) => [row.id as string, row.name as string]));
  const shipName = new Map(
    (ships.data ?? []).map((row) => {
      const model = modelName.get(row.model_id as string) ?? "a model that is gone";
      return [row.id as string, row.name ? `${row.name} (${model})` : `a ${model}`];
    }),
  );
  const templateName = new Map((templates.data ?? []).map((row) => [row.id as string, `the ${row.name} template of the ${modelName.get(row.model_id as string) ?? "model that is gone"}`]));
  const eventTitle = new Map((events.data ?? []).map((row) => [row.id as string, row.title as string]));
  const roleName = new Map((roles.data ?? []).map((row) => [row.id as string, row.name as string]));
  const areaName = new Map((areas.data ?? []).map((row) => [row.id as string, row.name as string]));
  const typeName = new Map((eventTypes.data ?? []).map((row) => [row.key as string, row.name as string]));
  const extraPostTitle = new Map((eventPosts.data ?? []).map((row) => [row.id as string, row.title as string]));
  const objectiveTitle = new Map((objectives.data ?? []).map((row) => [row.id as string, row.title as string]));
  const order = new Map((grades.data ?? []).map((row) => [row.code as string, row.sort_order as number]));
  const rankName = new Map((ranks.data ?? []).map((row) => [`${row.service}:${row.grade_code}`, row.name as string]));

  const names: Names = {
    member: (id) => (typeof id === "string" ? (memberName.get(id) ?? "someone whose record is gone") : "someone"),
    service: (id) => (typeof id === "string" ? (memberService.get(id) ?? null) : null),
    post: (id) => (typeof id === "string" ? (postName.get(id) ?? "a post that is gone") : "a post"),
    unit: (id) => (typeof id === "string" ? (unitName.get(id) ?? "a unit that is gone") : "no unit"),
    qualification: (id) => (typeof id === "string" ? (qualificationName.get(id) ?? "a qualification that is gone") : "a qualification"),
    lesson: (id) => (typeof id === "string" ? (lessonName.get(id) ?? "a lesson that is gone") : "a lesson"),
    model: (id) => (typeof id === "string" ? (modelName.get(id) ?? "a model that is gone") : "a model"),
    ship: (id) => (typeof id === "string" ? (shipName.get(id) ?? "a ship that is off the register") : "a ship"),
    template: (id) => (typeof id === "string" ? (templateName.get(id) ?? "a template that is gone") : "a template"),
    event: (id) => (typeof id === "string" ? (eventTitle.get(id) ?? "an event that is gone") : "an event"),
    eventType: (key) => (typeof key === "string" ? (typeName.get(key) ?? key) : "no type"),
    extraPost: (id) => (typeof id === "string" ? (extraPostTitle.get(id) ?? "a post that is gone") : "a post"),
    objective: (id) => (typeof id === "string" ? (objectiveTitle.get(id) ?? "an objective that is gone") : "an objective"),
    role: (id) => (typeof id === "string" ? (roleName.get(id) ?? "a role that is gone") : "no role"),
    area: (id) => (typeof id === "string" ? (areaName.get(id) ?? "an area that is gone") : "no area"),
    higher: (from, to) => {
      const was = order.get(String(from));
      const now = order.get(String(to));
      return was === undefined || now === undefined ? null : now > was;
    },
    rank: (service, grade) => {
      const name = service ? rankName.get(`${service}:${grade}`) : undefined;
      return name ? `${name} (${grade})` : String(grade);
    },
  };

  return {
    names,
    members: [...memberName.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name)),
  };
}

// ---------------------------------------------------------------------------
// Turning a line into a sentence
// ---------------------------------------------------------------------------

/** Fields that change by themselves and say nothing. */
const QUIET = new Set(["id", "updated_at", "recorded_at", "created_at", "sort_order"]);
/** Fields that hold a member's id. */
const PEOPLE = new Set([
  "member_id", "commander_id", "second_id", "observer_id", "created_by", "updated_by", "appointed_by", "awarded_by",
  "decided_by", "granted_by", "returned_by", "stand_in_set_by", "author_id",
]);

const moment = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One value of a changed field, as words: a name for an id, a date as a date. */
function shown(key: string, value: unknown, names: Names, table: string): string {
  if (value === null || value === undefined || value === "") return "nothing";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    if (PEOPLE.has(key)) return names.member(value);
    if (key === "position_id" || key === "stand_in_position_id") return names.post(value);
    if (key === "unit_id" || key === "parent_id") return names.unit(value);
    if (key === "qualification_id" || key === "requires_qualification_id" || key === "teaches_qualification_id") return names.qualification(value);
    if (key === "lesson_id") return names.lesson(value);
    if (key === "model_id") return names.model(value);
    if (key === "ship_id") return names.ship(value);
    if (key === "template_id") return names.template(value);
    if (key === "objective_id") return names.objective(value);
    if (key === "event_post_id") return names.extraPost(value);
    if (key === "role_id" || key === "next_role_id") return names.role(value);
    if (key === "area_id") return names.area(value);
    if (key === "event_id" || key === "copied_from") return names.event(value);
    if (key === "kind" && table === "events") return names.eventType(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return `${moment.format(new Date(value))} UTC`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return date.format(new Date(value));
  }
  return String(value);
}

/** The fields an update changed, as "field: old to new". Long text is only named. */
/** The fields that hold formatted text, by table. A log line gives their words, without the marks that format them. */
const FORMATTED: Record<string, string[]> = {
  event_orders: ["warning_order", "situation", "mission", "execution", "support", "command_and_signal"],
  event_elements: ["task"],
  event_mentions: ["citation"],
  areas: ["about"],
  fleet_roles: ["summary"],
  qualifications: ["description"],
  event_types: ["situation_holds", "mission_holds", "execution_holds", "support_holds", "command_and_signal_holds"],
  hostiles: ["reason"],
  routine_orders: ["body"],
};

function changes(row: AuditRow, names: Names, said: string[] = []): string | null {
  if (row.action !== "update" || !row.old_row || !row.new_row) return null;
  const parts: string[] = [];
  const words = (key: string, value: unknown) => (FORMATTED[row.table_name]?.includes(key) && typeof value === "string" ? plainText(value) : value);
  for (const key of Object.keys(row.new_row)) {
    // A field the line itself already speaks of is not said twice.
    if (QUIET.has(key) || said.includes(key)) continue;
    if (JSON.stringify(row.old_row[key]) === JSON.stringify(row.new_row[key])) continue;
    const was = words(key, row.old_row[key]);
    const now = words(key, row.new_row[key]);
    const label = key.replace(/_id$/, "").replaceAll("_", " ");
    const long =
      [was, now].some((value) => typeof value === "object" && value !== null) ||
      [was, now].some((value) => typeof value === "string" && value.length > 60);
    parts.push(long ? `${label} changed` : `${label}: ${shown(key, was, names, row.table_name)} to ${shown(key, now, names, row.table_name)}`);
  }
  return parts.length > 0 ? `${parts.join(". ")}.` : null;
}

function describeChange(row: AuditRow, names: Names): LogLine | null {
  const now = row.new_row ?? {};
  const was = row.old_row ?? {};
  const any = row.new_row ?? row.old_row ?? {};
  // The sign-in service and the database's own triggers act with nobody signed in.
  const actor = row.actor ? names.member(row.actor) : "The database";
  const subject = names.member(row.subject);
  const own = row.actor !== null && row.actor === row.subject;
  const whose = own ? "their" : `${subject}'s`;
  const changed = (key: string) => row.action === "update" && JSON.stringify(was[key]) !== JSON.stringify(now[key]);
  const line = (kind: LogKind, text: string, detail: string | null = null): LogLine => ({
    key: `a${row.id}`,
    at: row.at,
    kind,
    text,
    detail,
    tone: null,
  });

  switch (row.table_name) {
    case "members": {
      if (row.action === "insert") return line("records", `${subject} signed in for the first time, and a record was made`);
      if (row.action === "delete") return line("records", "A member's record was deleted, with everything the log held about them");
      if (changed("status")) {
        const from = statusNames[was.status as Status] ?? String(was.status);
        const to = statusNames[now.status as Status] ?? String(now.status);
        const also = changed("service") && now.service ? `, in the ${serviceNames[now.service as Service]}` : "";
        return line("personnel", `${actor} changed ${whose} status from ${from} to ${to}${also}`);
      }
      if (changed("service")) {
        const to = now.service ? `the ${serviceNames[now.service as Service]}` : "no service";
        return line("personnel", `${actor} moved ${own ? "themselves" : subject} to ${to}`);
      }
      const named = [
        changed("character_name") ? `character name from ${was.character_name ?? "nothing"} to ${now.character_name ?? "nothing"}` : null,
        changed("rsi_handle") ? `RSI handle from ${was.rsi_handle ?? "nothing"} to ${now.rsi_handle ?? "nothing"}` : null,
      ].filter(Boolean);
      if (named.length > 0) return line("records", `${actor} changed ${whose} ${named.join(" and ")}`);
      return line("records", `${actor} changed ${whose} record`, changes(row, names));
    }

    case "member_roles": {
      const role = roleNames[any.role as Role] ?? String(any.role);
      if (row.action === "insert") return line("personnel", `${actor} gave ${own ? "themselves" : subject} the ${role} role`);
      if (row.action === "delete") return line("personnel", `${actor} took away ${whose} ${role} role`);
      return line("personnel", `${actor} changed ${whose} ${role} role`, changes(row, names));
    }

    case "assignments": {
      const post = names.post(any.position_id);
      const duty = any.kind === "duty";
      const grade = (code: unknown) => names.rank(names.service(row.subject), code);
      if (row.action === "insert") {
        if (duty) return line("personnel", `${actor} gave ${subject} the duty of ${post}`);
        return line(
          "personnel",
          `${actor} appointed ${subject} ${now.acting === true ? "acting " : ""}${post}`,
          now.grade_code ? `Grade in post: ${grade(now.grade_code)}.` : null,
        );
      }
      if (row.action === "delete") return line("personnel", `${actor} deleted ${whose} appointment as ${post}, to put right a mistake`);
      if (changed("ended_on") && now.ended_on) return line("personnel", `${actor} ended ${whose} ${duty ? "duty" : "appointment"} as ${post}`);
      if (changed("grade_code")) {
        const up = names.higher(was.grade_code, now.grade_code);
        const verb = up === null ? "changed the grade of" : up ? "promoted" : "reduced";
        return line("personnel", `${actor} ${verb} ${subject} from ${grade(was.grade_code)} to ${grade(now.grade_code)}`, `In post as ${post}.`);
      }
      if (changed("acting")) {
        return line("personnel", now.acting === true ? `${actor} made ${whose} appointment as ${post} acting` : `${actor} confirmed ${subject} as ${post}`);
      }
      return line("personnel", `${actor} changed ${whose} appointment as ${post}`, changes(row, names));
    }

    case "qualification_awards": {
      const qualification = names.qualification(any.qualification_id);
      if (row.action === "insert") {
        // Signed off at an event that teaches it, or awarded away from one.
        return line(
          "personnel",
          now.event_id
            ? `${actor} signed ${subject} off for the ${qualification} qualification at ${names.event(now.event_id)}`
            : `${actor} awarded ${subject} the ${qualification} qualification`,
        );
      }
      if (row.action === "delete") return line("personnel", `${actor} took away ${whose} ${qualification} qualification`);
      return line("personnel", `${actor} changed ${whose} ${qualification} qualification`, changes(row, names));
    }

    case "lesson_passes": {
      const lesson = names.lesson(any.lesson_id);
      if (row.action === "insert") {
        return line("personnel", now.event_id ? `${actor} signed ${subject} off for the lesson ${lesson}, at ${names.event(now.event_id)}` : `${actor} signed ${subject} off for the lesson ${lesson}`);
      }
      if (row.action === "delete") return line("personnel", `${actor} withdrew the sign-off of ${subject} for the lesson ${lesson}`);
      return line("personnel", `${actor} changed ${whose} sign-off for the lesson ${lesson}`, changes(row, names));
    }

    case "lessons": {
      const course = names.qualification(any.qualification_id);
      if (row.action === "insert") return line("structure", `${actor} added the lesson ${now.name} to ${course}`);
      if (row.action === "delete") return line("structure", `${actor} removed the lesson ${was.name} from ${course}`);
      return line("structure", `${actor} changed the lesson ${was.name} of ${course}`, changes(row, names));
    }

    case "ships": {
      const model = names.model(any.model_id);
      const called = any.name ? ` named ${any.name}` : "";
      const ownerWords = row.subject ? (own ? "" : ` for ${subject}`) : " as the fleet's";
      const owned = row.subject ? whose : "the fleet's";
      if (row.action === "insert") return line("personnel", `${actor} registered a ${model}${called}${ownerWords}`);
      if (row.action === "delete") return line("personnel", `${actor} took a ${model}${called} off the register${ownerWords}`);
      if (changed("ready")) return line("personnel", `${actor} marked ${owned} ${model}${called} ${now.ready ? "ready" : "not ready"}`);
      return line("personnel", `${actor} changed ${owned} ${model}${called} on the register`, changes(row, names));
    }

    case "ship_notes": {
      const ship = names.ship(any.ship_id);
      if (row.action === "insert") return line("personnel", `${actor} wrote a note on ${ship}`);
      if (row.action === "delete") return line("personnel", `${actor} removed the note on ${ship}`);
      return line("personnel", `${actor} changed the note on ${ship}`);
    }

    case "event_ship_offers": {
      const ship = names.ship(any.ship_id);
      const event = names.event(any.event_id);
      if (row.action === "insert") return line("operations", `${actor} offered ${ship} for ${event}`);
      return line("operations", `${actor} withdrew ${ship} from ${event}`);
    }

    case "ship_models": {
      if (row.action === "insert") return line("structure", `${actor} added the ship model ${now.name}`);
      if (row.action === "delete") return line("structure", `${actor} removed the ship model ${was.name}`);
      return line("structure", `${actor} changed the ship model ${was.name}`, changes(row, names));
    }

    case "crew_templates": {
      const model = names.model(any.model_id);
      if (row.action === "insert") return line("structure", `${actor} added the ${now.name} crew template to the ${model}`);
      if (row.action === "delete") return line("structure", `${actor} removed the ${was.name} crew template from the ${model}`);
      if (changed("is_default") && now.is_default === true) return line("structure", `${actor} made ${now.name} the standard crew template of the ${model}`);
      return line("structure", `${actor} changed the ${was.name} crew template of the ${model}`, changes(row, names));
    }

    case "crew_template_stations": {
      const template = names.template(any.template_id);
      const role = names.role(any.role_id);
      if (row.action === "insert") return line("structure", `${actor} set ${now.count} ${role} ${Number(now.count) === 1 ? "station" : "stations"} on ${template}`);
      if (row.action === "delete") return line("structure", `${actor} took the ${role} ${Number(was.count) === 1 ? "station" : "stations"} off ${template}`);
      return line("structure", `${actor} set ${now.count} ${role} ${Number(now.count) === 1 ? "station" : "stations"} on ${template}`, changes(row, names));
    }

    case "applications": {
      if (row.action === "insert") {
        const service = serviceNames[now.preferred_service as Service] ?? "a service";
        return line("recruiting", `${subject} applied to join the ${service}${now.route === "cadet" ? ", for the cadet course" : ""}`);
      }
      if (row.action === "delete") return line("recruiting", `${actor} deleted ${whose} application`);
      if (changed("stage")) {
        if (now.stage === "withdrawn") return line("recruiting", `${subject} withdrew their application`);
        if (now.stage === "interview") return line("recruiting", `${actor} moved ${whose} application to interview`);
        if (now.stage === "accepted") return line("recruiting", `${actor} accepted ${whose} application`);
        if (now.stage === "declined") return line("recruiting", `${actor} declined ${whose} application`);
      }
      return line("recruiting", `${actor} changed ${whose} application`, changes(row, names));
    }

    case "application_notes":
      return line(
        "recruiting",
        row.action === "delete" ? `${actor} removed an interview note on ${whose} application` : `${actor} wrote an interview note on ${whose} application`,
      );

    case "fleet_settings": {
      if (changed("recruitment_open")) return line("recruiting", `${actor} ${now.recruitment_open === true ? "opened" : "closed"} recruitment`);
      if (changed("current_stage")) return line("structure", `${actor} moved the fleet from stage ${was.current_stage} to stage ${now.current_stage}`);
      if (changed("open_services")) {
        const open = Array.isArray(now.open_services) ? now.open_services.map((service) => serviceNames[service as Service] ?? service).join(", ") : "";
        return line("structure", `${actor} set the open services to ${open}`);
      }
      return null;
    }

    case "fleet_role_qualifications": {
      const qualification = names.qualification(any.qualification_id);
      const role = names.role(any.role_id);
      if (row.action === "insert") return line("structure", `${actor} made the ${qualification} qualification a need of every ${role}`);
      if (row.action === "delete") return line("structure", `${actor} stopped every ${role} needing the ${qualification} qualification`);
      return line("structure", `${actor} changed how the ${role} role needs the ${qualification} qualification`, changes(row, names));
    }

    case "areas":
    case "fleet_roles":
    case "units":
    case "qualifications": {
      const thing = { areas: "area", fleet_roles: "role", units: "unit", qualifications: "qualification" }[row.table_name];
      const name = String(any.name ?? `a ${thing}`);
      if (row.action === "insert") return line("structure", `${actor} added the ${thing} ${name}`);
      if (row.action === "delete") return line("structure", `${actor} removed the ${thing} ${name}`);
      return line("structure", `${actor} changed the ${thing} ${name}`, changes(row, names));
    }

    case "positions": {
      const name = `${any.title ?? "a post"}, ${names.unit(any.unit_id)}`;
      if (row.action === "insert") return line("structure", `${actor} added the post ${name}`);
      if (row.action === "delete") return line("structure", `${actor} removed the post ${name}`);
      return line("structure", `${actor} changed the post ${name}`, changes(row, names));
    }

    case "position_qualifications": {
      const qualification = names.qualification(any.qualification_id);
      const post = names.post(any.position_id);
      if (row.action === "insert") return line("structure", `${actor} made the ${qualification} qualification a requirement of ${post}`);
      if (row.action === "delete") return line("structure", `${actor} stopped ${post} requiring the ${qualification} qualification`);
      return line("structure", `${actor} changed how ${post} requires the ${qualification} qualification`, changes(row, names));
    }

    case "grades":
      return line("structure", `${actor} ${row.action === "update" ? "changed" : row.action === "insert" ? "added" : "removed"} the grade ${any.code}`, changes(row, names));

    case "ranks": {
      const service = serviceNames[any.service as Service] ?? String(any.service);
      if (changed("name")) return line("structure", `${actor} renamed the ${service} rank for ${any.grade_code} from ${was.name} to ${now.name}`);
      return line("structure", `${actor} ${row.action === "insert" ? "added" : row.action === "delete" ? "removed" : "changed"} the ${service} rank for ${any.grade_code}`, changes(row, names));
    }

    case "event_types": {
      const name = String(any.name ?? "an event type");
      if (row.action === "insert") return line("structure", `${actor} added the event type ${name}`);
      if (row.action === "delete") return line("structure", `${actor} removed the event type ${name}`);
      if (changed("instructors_may_draft")) {
        return line(
          "structure",
          now.instructors_may_draft === true ? `${actor} opened the event type ${name} to instructors` : `${actor} closed the event type ${name} to instructors`,
          changes(row, names, ["instructors_may_draft"]),
        );
      }
      return line("structure", `${actor} changed the event type ${name}`, changes(row, names));
    }

    case "events": {
      const title = String(any.title ?? "an event");
      if (row.action === "insert") {
        const type = `${names.eventType(now.kind)}.`;
        // With nobody's hand on it but the closer's, a weekly event's follow-on is drafted by the database.
        if (now.copied_from && now.repeats_weekly === true) {
          return line("operations", `${title} was drafted for next week when ${actor} ended ${names.event(now.copied_from)}`, type);
        }
        if (now.copied_from) return line("operations", `${actor} drafted ${title}, as a copy of ${names.event(now.copied_from)}`, type);
        return line("operations", `${actor} drafted ${title}`, `${type}${now.repeats_weekly === true ? " It repeats weekly." : ""}`);
      }
      if (row.action === "delete") return line("operations", `${actor} deleted the draft ${title}`);
      if (changed("state")) {
        if (now.state === "announced") return line("operations", `${actor} announced ${title}`);
        if (now.state === "cancelled") return line("operations", `${actor} cancelled ${title}`);
        if (now.state === "done") return line("operations", `${actor} closed ${title}`);
      }
      if (changed("approval")) {
        if (now.approval === "approved") return line("operations", `${actor} approved ${title}`);
        if (now.approval === "asked") return line("operations", `${actor} asked command to approve ${title}`);
        return line("operations", was.approval === "approved" ? `${actor} took back the approval of ${title}` : `${actor} took back the request to approve ${title}`);
      }
      if (changed("repeats_weekly") && Object.keys(now).filter((key) => changed(key) && !QUIET.has(key)).length === 1) {
        return line("operations", now.repeats_weekly === true ? `${actor} set ${title} to repeat weekly` : `${actor} stopped ${title} repeating weekly`);
      }
      return line("operations", `${actor} changed the details of ${title}`, changes(row, names));
    }

    case "event_orders":
      return line("operations", `${actor} changed the orders of ${names.event(any.event_id)}`, changes(row, names));

    case "event_objectives":
    case "event_elements":
    case "event_ships":
    case "event_nets": {
      const event = names.event(any.event_id);
      const [thing, called] = {
        event_objectives: ["objective", any.title],
        event_elements: ["element", any.name],
        event_ships: ["ship", any.ship],
        event_nets: ["net", any.name],
      }[row.table_name] as [string, unknown];
      const name = `${thing} ${String(called ?? "")}`.trim();
      if (row.action === "insert") return line("operations", `${actor} added the ${name} to the plan of ${event}`);
      if (row.action === "delete") return line("operations", `${actor} removed the ${name} from the plan of ${event}`);
      return line("operations", `${actor} changed the ${name} in the plan of ${event}`, changes(row, names));
    }

    case "event_timings": {
      const event = names.event(any.event_id);
      const timing = `${hLabel(Number(any.offset_minutes ?? 0))} ${String(any.label ?? "")}`.trim();
      if (row.action === "insert") return line("operations", `${actor} added ${timing} to the timeline of ${event}`);
      if (row.action === "delete") return line("operations", `${actor} removed ${timing} from the timeline of ${event}`);
      return line("operations", `${actor} changed ${timing} in the timeline of ${event}`, changes(row, names));
    }

    case "event_amendments": {
      const event = names.event(any.event_id);
      if (row.action === "delete") return line("operations", `${actor} deleted amendment ${any.number} to the orders of ${event}`);
      const body = plainText(String(now.body ?? ""));
      return line("operations", `${actor} issued amendment ${any.number} to the orders of ${event}`, body.length > 240 ? `${body.slice(0, 240)}…` : body);
    }

    case "event_acknowledgements": {
      const event = names.event(any.event_id);
      if (row.action === "delete") return line("operations", `${actor} removed ${whose} acknowledgement for ${event}`);
      return line("operations", `${subject} acknowledged amendment ${now.amendment_number} to the orders of ${event}`);
    }

    case "event_objective_outcomes": {
      const event = names.event(any.event_id);
      const objective = names.objective(any.objective_id);
      if (row.action === "delete") return line("operations", `${actor} took back how "${objective}" turned out at ${event}`);
      const outcome = (outcomeNames[now.outcome as Outcome] ?? String(now.outcome)).toLowerCase();
      return line("operations", `${actor} recorded "${objective}" as ${outcome} at ${event}`, now.note ? String(now.note) : null);
    }

    case "event_losses": {
      const event = names.event(any.event_id);
      const lost = `${Number(any.quantity ?? 1) > 1 ? `${any.quantity} × ` : ""}${String(any.item ?? "a loss")}`;
      if (row.action === "insert") return line("operations", `${actor} recorded the loss of ${lost} at ${event}`, now.note ? String(now.note) : null);
      if (row.action === "delete") return line("operations", `${actor} removed the loss of ${lost} from the report of ${event}`);
      return line("operations", `${actor} corrected the loss of ${lost} at ${event}`, changes(row, names));
    }

    case "event_mentions": {
      const event = names.event(any.event_id);
      if (row.action === "insert") return line("personnel", `${actor} mentioned ${subject} in the report of ${event}`, plainText(String(now.citation ?? "")));
      if (row.action === "delete") return line("personnel", `${actor} withdrew ${whose} mention in the report of ${event}`);
      return line("personnel", `${actor} corrected ${whose} mention in the report of ${event}`, plainText(String(now.citation ?? "")));
    }

    case "hostiles": {
      // The name is a player's handle or an organisation's ID from the game. What it is said to have done stays on the list.
      const name = `${any.kind === "organisation" ? "the organisation " : ""}${String(any.handle)}`;
      const level = (value: unknown) => (value === "watch" ? "on watch" : "as hostile");
      if (row.action === "insert") {
        return line("operations", now.state === "listed" ? `${actor} listed ${name} ${level(now.level)}` : `${actor} put ${name} forward for the hostile list`);
      }
      if (row.action === "delete") {
        return line("operations", was.state === "proposed" ? `${actor} took back ${name}, which they had put forward for the hostile list` : `${actor} deleted the hostile list's entry for ${name}, to put right a mistake`);
      }
      const said = typeof now.decision_note === "string" && now.decision_note !== "" && changed("decision_note") ? `Command said: ${now.decision_note}` : null;
      if (changed("state")) {
        if (now.state === "listed") return line("operations", `${actor} listed ${name} ${level(now.level)}`, said);
        if (now.state === "declined") return line("operations", `${actor} declined to list ${name}`, said);
        if (now.state === "lifted") {
          const why = typeof now.lift_note === "string" && now.lift_note !== "" ? `Command said: ${now.lift_note}` : null;
          return line("operations", `${actor} lifted ${name} from the hostile list`, why);
        }
      }
      if (changed("level")) return line("operations", now.level === "watch" ? `${actor} moved ${name} from hostile to watch` : `${actor} made ${name} hostile, from watch`);
      // The database's own housekeeping, when something the entry pointed to was deleted.
      if (changed("report_id") && !now.report_id) {
        return line("operations", `The piracy report that the hostile list's entry for ${name} was started from was deleted. The entry stays`);
      }
      if (["reported_by", "decided_by", "renewed_by", "lifted_by"].some((key) => changed(key) && !now[key]) && !["name", "reason", "evidence"].some(changed)) {
        return line("operations", `A member named on the hostile list's entry for ${name} was deleted, and their name was cleared from it`);
      }
      if (changed("renewed_at")) return line("operations", `${actor} renewed ${name} on the hostile list`, now.expires_on ? `It stands to ${String(now.expires_on)}.` : null);
      return line("operations", `${actor} rewrote the hostile list's entry for ${name}`, changes(row, names));
    }

    case "routine_orders": {
      const which = typeof now.number === "number" ? `Routine Orders ${now.number}` : typeof was.number === "number" ? `Routine Orders ${was.number}` : "a draft of routine orders";
      if (row.action === "insert") return line("operations", `${actor} opened a draft of routine orders`);
      if (row.action === "delete") return line("operations", `${actor} discarded a draft of routine orders`);
      if (changed("state") && now.state === "issued") return line("operations", `${actor} issued ${which}`, now.title ? String(now.title) : null);
      if (["drafted_by", "issued_by"].some((key) => changed(key) && !now[key]) && !changed("body") && !changed("title")) {
        return line("operations", `A member named on ${which} was deleted, and their name was cleared from it`);
      }
      return line("operations", now.state === "issued" ? `${actor} corrected ${which}` : `${actor} wrote the draft of routine orders`);
    }

    case "piracy_reports": {
      // What a report said stays on the reports page, for command. The log says that it came and what was done with it.
      if (row.action === "insert") return line("operations", `A piracy report arrived${now.urgent === true ? ", marked as happening now" : ""}`);
      if (row.action === "delete") {
        // Nobody is sent a report twelve months old, so nobody deletes one by hand: the database cleared it.
        const cleared = new Date(row.at);
        cleared.setUTCMonth(cleared.getUTCMonth() - 12);
        const old = Date.parse(String(was.received_at ?? row.at)) <= cleared.getTime();
        return line("operations", old ? "A piracy report reached twelve months old and was deleted" : `${actor} deleted a piracy report`);
      }
      if (changed("state")) {
        const said = typeof now.outcome_note === "string" && now.outcome_note !== "" ? `Command said: ${now.outcome_note}` : null;
        if (now.state === "handled") return line("operations", `${actor} marked a piracy report as handled`, said);
        if (now.state === "dismissed") return line("operations", `${actor} dismissed a piracy report`, said);
        return line("operations", `${actor} reopened a piracy report`);
      }
      if (changed("event_id")) {
        return line("operations", now.event_id ? `${actor} drafted ${names.event(now.event_id)} from a piracy report` : "The Response event drafted from a piracy report was deleted");
      }
      if (changed("handled_by") && !now.handled_by) {
        return line("operations", "The member who had handled a piracy report was deleted, and their name was cleared from it");
      }
      return line("operations", `${actor} changed a note on a piracy report`);
    }

    case "event_opfor": {
      const event = names.event(any.event_id);
      if (row.action === "delete") return line("operations", `${actor} removed the opposing force's plan for ${event}`);
      // What the plan says is not put in the log's sentence. The record itself holds it.
      return line("operations", `${actor} wrote the opposing force's plan for ${event}`);
    }

    case "event_opfor_members": {
      const event = names.event(any.event_id);
      if (row.action === "insert") {
        return line("operations", `${actor} named ${subject} to the opposing force of ${event}${now.leads === true ? ", to lead it" : ""}`);
      }
      if (row.action === "delete") return line("operations", `${actor} took ${subject} off the opposing force of ${event}`);
      return line("operations", now.leads === true ? `${actor} made ${subject} lead the opposing force of ${event}` : `${actor} said ${subject} no longer leads the opposing force of ${event}`);
    }

    case "event_unit_tasks": {
      const event = names.event(any.event_id);
      const unit = names.unit(any.unit_id);
      const reader = (level: unknown) => (typeof level === "string" && level in levelWords ? levelWords[level as keyof typeof levelWords] : "nobody");
      // What a task says is not put in the log's sentence, since it may be withheld. The record itself holds it.
      if (row.action === "delete") return line("operations", `${actor} took away the task of ${unit} for ${event}`);
      if (row.action === "insert") return line("operations", `${actor} gave ${unit} its task for ${event}`, `Read by ${reader(now.level)}.`);
      if (now.level !== was.level) {
        return line("operations", `${actor} changed who reads the task of ${unit} for ${event}`, `Now ${reader(now.level)}. Before, ${reader(was.level)}.`);
      }
      return line("operations", `${actor} changed the task of ${unit} for ${event}`);
    }

    case "event_units": {
      const event = names.event(any.event_id);
      const unit = names.unit(any.unit_id);
      if (row.action === "delete") return line("operations", `${actor} took ${unit} out of ${event}`);
      return line("operations", `${actor} named ${unit} as taking part in ${event}`);
    }

    case "event_key_posts": {
      const event = names.event(any.event_id);
      const post = names.post(any.position_id);
      if (row.action === "delete") return line("operations", `${actor} said ${post} need not be filled for ${event}`);
      return line("operations", `${actor} said ${post} must be filled for ${event}`);
    }

    case "event_posts": {
      const event = names.event(any.event_id);
      const title = String(any.title ?? "a post");
      if (row.action === "insert") {
        const role = now.role_id ? `Role: ${names.role(now.role_id)}.` : null;
        return line("operations", `${actor} added the post ${title} to ${event}`, [role, now.must_fill === true ? "It must be filled." : null].filter(Boolean).join(" ") || null);
      }
      if (row.action === "delete") return line("operations", `${actor} removed the post ${title} from ${event}`);
      return line("operations", `${actor} changed the post ${title} of ${event}`, changes(row, names));
    }

    case "attendance": {
      const event = names.event(any.event_id);
      const reply = replyNames[String(now.reply)] ?? "nothing";
      if (row.action === "delete") return line("operations", `${actor} removed ${whose} line from the roll of ${event}`);
      if (changed("stand_in_position_id")) {
        if (now.stand_in_position_id) {
          const post = names.post(now.stand_in_position_id);
          return line("operations", own ? `${actor} stood in as ${post} for ${event}` : `${actor} placed ${subject} as ${post} for ${event}`);
        }
        return line("operations", `${actor} took ${own ? "themselves" : subject} out of ${names.post(was.stand_in_position_id)} for ${event}`);
      }
      if (changed("event_post_id")) {
        if (now.event_post_id) {
          const post = names.extraPost(now.event_post_id);
          return line("operations", own ? `${actor} took the post ${post} for ${event}` : `${actor} placed ${subject} as ${post} for ${event}`);
        }
        // Dropping out gives the post up, which the reply's own line says.
        if (!changed("reply")) {
          return line("operations", `${actor} took ${own ? "themselves" : subject} out of ${names.extraPost(was.event_post_id)} for ${event}`);
        }
      }
      if (row.action === "insert" || changed("reply")) {
        const where = now.place === "reserve" ? "Every place was taken, so they are on the reserve list." : null;
        return line("operations", own ? `${actor} replied ${reply} to ${event}` : `${actor} put ${subject} down as ${reply} for ${event}`, where);
      }
      if (changed("place")) {
        // A place that opens goes to the first on the list by itself, in the name of whoever gave it up.
        if (now.place === "in") return line("operations", `${subject} was given a place at ${event}, from the reserve list`);
        return line("operations", `${actor} moved ${subject} to the reserve list for ${event}`);
      }
      return line("operations", `${actor} changed ${whose} line on the roll of ${event}`, changes(row, names));
    }

    case "attendance_returns": {
      const event = names.event(any.event_id);
      const returned = (returnedNames[any.returned as Returned] ?? String(any.returned)).toLowerCase();
      if (row.action === "delete") return line("operations", `${actor} removed ${whose} line from the return for ${event}`);
      return line(
        "operations",
        row.action === "insert" ? `${actor} recorded ${subject} as ${returned} at ${event}` : `${actor} corrected ${whose} return for ${event} to ${returned}`,
      );
    }

    case "after_action_reports": {
      const event = names.event(any.event_id);
      if (row.action === "delete") return line("operations", `${actor} deleted the after-action report for ${event}`);
      return line("operations", `${actor} ${row.action === "insert" ? "filed" : "corrected"} the after-action report for ${event}`);
    }

    default:
      // A table added later still shows, plainly, until it is given its own words.
      return line("structure", `${actor} ${row.action === "insert" ? "added to" : row.action === "delete" ? "removed from" : "changed"} ${row.table_name.replaceAll("_", " ")}`, changes(row, names));
  }
}

function describeActivity(row: ActivityRow, names: Names): LogLine {
  const actor = names.member(row.actor);
  const attempt = row.action && row.action in attemptNames ? attemptNames[row.action as Attempt] : (row.action ?? "do something");
  const base = { key: `b${row.id}`, at: row.at };
  if (row.kind === "sign_in") return { ...base, kind: "sign-ins", text: `${actor} signed in`, detail: null, tone: null };
  if (row.kind === "sign_out") return { ...base, kind: "sign-ins", text: `${actor} signed out`, detail: null, tone: null };
  const said = [row.shown ? `Told: "${row.shown}"` : null, row.cause ? `The database said: ${row.cause}` : null].filter(Boolean).join(" ");
  return {
    ...base,
    kind: "refused",
    text: row.kind === "refused" ? `${actor} was refused: tried to ${attempt}` : `${actor} tried to ${attempt}, and it failed`,
    detail: said || null,
    tone: row.kind,
  };
}

// ---------------------------------------------------------------------------
// Visitors: how many times each public page was read
// ---------------------------------------------------------------------------

export type Visitors =
  | { state: "no-database" }
  | {
      state: "ready";
      today: { views: number; landings: number };
      week: { views: number; landings: number };
      month: { views: number; landings: number };
      /** The last 14 days, oldest first. */
      days: { label: string; long: string; value: number }[];
      /** Pages read in the last 30 days, the most read first. */
      pages: { path: string; views: number; landings: number }[];
      /** Sign-ins that did not finish, in the last 30 days. */
      signIn: { cancelled: number; failed: number };
    };

export async function readVisitors(): Promise<Visitors> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const day = 24 * 60 * 60 * 1000;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const key = (at: number) => new Date(at).toISOString().slice(0, 10);

  const [byDay, byPage] = await Promise.all([
    supabase
      .from("page_views_by_day")
      .select("day, views, landings")
      .gte("day", key(today - 29 * day))
      .order("day", { ascending: true }),
    supabase.from("page_views_by_page").select("path, views, landings").order("views", { ascending: false }).limit(200),
  ]);
  if (byDay.error) throw new Error(`The page views could not be read: ${byDay.error.message}`);
  if (byPage.error) throw new Error(`The page views could not be read: ${byPage.error.message}`);

  const totals = new Map((byDay.data ?? []).map((row) => [row.day as string, { views: row.views as number, landings: row.landings as number }]));
  const sum = (days: number) => {
    const total = { views: 0, landings: 0 };
    for (let back = 0; back < days; back += 1) {
      const found = totals.get(key(today - back * day));
      if (found) {
        total.views += found.views;
        total.landings += found.landings;
      }
    }
    return total;
  };
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  // An address under /sign-in/ is not a page. It counts a sign-in that came back without a session.
  const pages = (byPage.data ?? []).map((row) => ({ path: row.path as string, views: row.views as number, landings: row.landings as number }));
  const problem = (name: string) => pages.find((page) => page.path === `/sign-in/${name}`)?.views ?? 0;

  return {
    state: "ready",
    today: sum(1),
    week: sum(7),
    month: sum(30),
    days: Array.from({ length: 14 }, (_, index) => {
      const at = today - (13 - index) * day;
      return { label: short.format(at), long: long.format(at), value: totals.get(key(at))?.views ?? 0 };
    }),
    pages: pages.filter((page) => !page.path.startsWith("/sign-in/")),
    signIn: { cancelled: problem("cancelled"), failed: problem("service") + problem("callback") + problem("discord") },
  };
}

/** Whether the person asking is an admin, for the page to check before it reads anything. */
export const gateLogs = () => gate("admin", "/admin/logs");
