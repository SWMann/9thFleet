import "server-only";
import { refused } from "@/lib/activity";
import { readStoredAnswers, type StoredAnswers } from "@/lib/application-form";
import { getSession, isStaff, type Member, type Service, type Status } from "@/lib/member";
import { createClient } from "@/lib/supabase/server";

export type Stage = "submitted" | "interview" | "accepted" | "declined" | "withdrawn";
export type Route = "recruit" | "cadet";

/** An application as its applicant sees it. */
export type MyApplication = {
  id: string;
  stage: Stage;
  route: Route;
  service: Service;
  submittedAt: string;
  decidedAt: string | null;
};

const LIMIT = 3;
const WINDOW_DAYS = 30;

export type ApplyState =
  | { state: "no-database" | "signed-out" | "no-record" }
  /** Already inside the fleet, or discharged from it. */
  | { state: "not-an-applicant"; status: Status }
  /** An application is with staff. */
  | { state: "waiting"; application: MyApplication }
  | { state: "closed"; last: MyApplication | null }
  /** A character name and an RSI handle are needed before applying. */
  | { state: "names"; last: MyApplication | null }
  /** Three applications in 30 days is the most the database accepts. */
  | { state: "limit"; again: string; last: MyApplication | null }
  | { state: "ready"; services: Service[]; last: MyApplication | null };

type ApplicationRow = {
  id: string;
  member_id: string;
  stage: Stage;
  route: Route;
  preferred_service: Service;
  submitted_at: string;
  decided_at: string | null;
};

const mine = (row: ApplicationRow): MyApplication => ({
  id: row.id,
  stage: row.stage,
  route: row.route,
  service: row.preferred_service,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
});

const SUMMARY = "id, member_id, stage, route, preferred_service, submitted_at, decided_at";

/**
 * Where the signed-in person stands on applying. The page uses it to choose
 * what to show. The database makes the real decision when the form is sent.
 */
export async function getApplyState(): Promise<ApplyState> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  const { member } = session;
  if (member.status !== "applicant") return { state: "not-an-applicant", status: member.status };

  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [applications, settings] = await Promise.all([
    supabase.from("applications").select(SUMMARY).eq("member_id", member.id).order("submitted_at", { ascending: false }),
    supabase.from("fleet_settings").select("recruitment_open, open_services").maybeSingle(),
  ]);
  for (const result of [applications, settings]) {
    if (result.error) throw new Error(`Your applications could not be read: ${result.error.message}`);
  }

  const rows = (applications.data ?? []) as ApplicationRow[];
  const open = rows.find((row) => row.stage === "submitted" || row.stage === "interview");
  if (open) return { state: "waiting", application: mine(open) };

  const last = rows.length > 0 ? mine(rows[0]) : null;
  if (settings.data?.recruitment_open !== true) return { state: "closed", last };
  if (!member.characterName || !member.rsiHandle) return { state: "names", last };

  const windowStart = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = rows.filter((row) => new Date(row.submitted_at).getTime() > windowStart);
  if (recent.length >= LIMIT) {
    // The oldest of the last three leaves the 30 days first.
    const oldest = new Date(recent[LIMIT - 1].submitted_at).getTime();
    return { state: "limit", again: new Date(oldest + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(), last };
  }

  const services = toServices(settings.data?.open_services);
  return { state: "ready", services: services.length > 0 ? services : ["navy"], last };
}

/** The API gives a list of services as an array, or as text such as {navy,army}. */
function toServices(value: unknown): Service[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/^\{|\}$/g, "").split(",")
      : [];
  return items.filter((item): item is Service => item === "navy" || item === "army" || item === "marines");
}

/** An application as staff see it in the list. */
export type ApplicationSummary = MyApplication & {
  memberId: string;
  name: string | null;
  handle: string | null;
  /** The reader's own application. Someone else decides it. */
  own: boolean;
};

export type ApplicationList =
  | { state: "no-database" | "signed-out" | "no-record" | "not-staff" }
  | { state: "ready"; applications: ApplicationSummary[]; recruitmentOpen: boolean; admin: boolean };

type NameRow = { member_id: string; character_name: string | null; rsi_handle: string | null; status: Status };

async function staffSession(): Promise<
  { state: "no-database" | "signed-out" | "no-record" | "not-staff" } | { state: "staff"; member: Member; recruitmentOpen: boolean }
> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  if (!isStaff(session.member)) {
    // Nobody is offered a link to the staff pages without a role, so reaching one anyway is written down.
    const supabase = await createClient();
    if (supabase) await refused(supabase, "page.staff", "The applications are for the fleet's staff.");
    return { state: "not-staff" };
  }
  return { state: "staff", member: session.member, recruitmentOpen: session.recruitmentOpen };
}

/** Every application, newest first. The database returns them to staff only. */
export async function listApplications(): Promise<ApplicationList> {
  const session = await staffSession();
  if (session.state !== "staff") return session;
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const applications = await supabase.from("applications").select(SUMMARY).order("submitted_at", { ascending: false });
  if (applications.error) throw new Error(`The applications could not be read: ${applications.error.message}`);
  const rows = (applications.data ?? []) as ApplicationRow[];
  const names = await namesOf(
    supabase,
    rows.map((row) => row.member_id),
  );

  return {
    state: "ready",
    recruitmentOpen: session.recruitmentOpen,
    admin: session.member.roles.includes("admin"),
    applications: rows.map((row) => ({
      ...mine(row),
      memberId: row.member_id,
      name: names.get(row.member_id)?.character_name ?? null,
      handle: names.get(row.member_id)?.rsi_handle ?? null,
      own: row.member_id === session.member.id,
    })),
  };
}

type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function namesOf(supabase: Client, ids: (string | null)[]): Promise<Map<string, NameRow>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const found = new Map<string, NameRow>();
  if (wanted.length === 0) return found;
  const roster = await supabase.from("roster").select("member_id, character_name, rsi_handle, status").in("member_id", wanted);
  if (roster.error) throw new Error(`The names could not be read: ${roster.error.message}`);
  for (const row of (roster.data ?? []) as NameRow[]) found.set(row.member_id, row);
  return found;
}

export type Note = { id: string; body: string; writtenAt: string; author: string | null; own: boolean };

export type ApplicationDetail = ApplicationSummary & {
  answers: StoredAnswers;
  discordName: string | null;
  applicantStatus: Status | null;
  decidedBy: string | null;
  notes: Note[];
};

export type ApplicationPage =
  | { state: "no-database" | "signed-out" | "no-record" | "not-staff" | "not-found" }
  | { state: "ready"; application: ApplicationDetail };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One application with its answers and interview notes, for staff. */
export async function getApplication(id: string): Promise<ApplicationPage> {
  const session = await staffSession();
  if (session.state !== "staff") return session;
  if (!UUID.test(id)) return { state: "not-found" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [application, notes] = await Promise.all([
    supabase.from("applications").select(`${SUMMARY}, answers, decided_by`).eq("id", id).maybeSingle(),
    supabase
      .from("application_notes")
      .select("id, author_id, body, created_at")
      .eq("application_id", id)
      .order("created_at", { ascending: true }),
  ]);
  for (const result of [application, notes]) {
    if (result.error) throw new Error(`The application could not be read: ${result.error.message}`);
  }
  if (!application.data) return { state: "not-found" };

  const row = application.data as ApplicationRow & { answers: unknown; decided_by: string | null };
  const noteRows = (notes.data ?? []) as { id: string; author_id: string | null; body: string; created_at: string }[];

  const [names, account] = await Promise.all([
    namesOf(supabase, [row.member_id, row.decided_by, ...noteRows.map((note) => note.author_id)]),
    supabase.from("member_accounts").select("discord_name").eq("member_id", row.member_id).maybeSingle(),
  ]);
  if (account.error) throw new Error(`The applicant's account could not be read: ${account.error.message}`);

  const applicant = names.get(row.member_id);
  return {
    state: "ready",
    application: {
      ...mine(row),
      memberId: row.member_id,
      name: applicant?.character_name ?? null,
      handle: applicant?.rsi_handle ?? null,
      own: row.member_id === session.member.id,
      answers: readStoredAnswers(row.answers),
      discordName: account.data?.discord_name ?? null,
      applicantStatus: applicant?.status ?? null,
      decidedBy: row.decided_by ? (names.get(row.decided_by)?.character_name ?? null) : null,
      notes: noteRows.map((note) => ({
        id: note.id,
        body: note.body,
        writtenAt: note.created_at,
        author: note.author_id ? (names.get(note.author_id)?.character_name ?? null) : null,
        own: note.author_id === session.member.id,
      })),
    },
  };
}
