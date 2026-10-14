import "server-only";
import { getSession, isServing, type Member, type Status } from "@/lib/member";
import { createClient } from "@/lib/supabase/server";

/**
 * Training records, read as the member asking. Each qualification is a course
 * of lessons. The database sends the syllabus to the serving fleet and to
 * staff, a member's own passes to them, and everyone's to instructors and
 * staff.
 */

export type Lesson = { id: string; name: string; description: string; sortOrder: number };
export type Course = {
  id: string;
  code: string;
  name: string;
  description: string;
  requires: { id: string; name: string } | null;
  lessons: Lesson[];
};
export type Pass = { lessonId: string; memberId: string; signedBy: string | null; signedAt: string; eventId: string | null };
export type Named = { id: string; name: string };

type Row = Record<string, unknown>;
type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const SERVING: Status[] = ["recruit", "auxiliary", "member", "reserve"];

const toPass = (row: Row): Pass => ({
  lessonId: row.lesson_id as string,
  memberId: row.member_id as string,
  signedBy: (row.signed_by as string | null) ?? null,
  signedAt: row.signed_at as string,
  eventId: (row.event_id as string | null) ?? null,
});

/** The courses, each with its lessons in order, the ones required first before the ones that need them. */
export async function getSyllabus(supabase: Client): Promise<Course[]> {
  const [qualifications, lessons] = await Promise.all([
    supabase.from("qualifications").select("id, code, name, description, requires_qualification_id"),
    supabase.from("lessons").select("id, qualification_id, sort_order, name, description"),
  ]);
  for (const result of [qualifications, lessons]) {
    if (result.error) throw new Error(`The syllabus could not be read: ${result.error.message}`);
  }
  const rows = (qualifications.data ?? []) as Row[];
  const nameOf = new Map(rows.map((row) => [row.id as string, row.name as string]));
  const lessonsOf = new Map<string, Lesson[]>();
  for (const row of (lessons.data ?? []) as Row[]) {
    const list = lessonsOf.get(row.qualification_id as string) ?? [];
    list.push({ id: row.id as string, name: row.name as string, description: (row.description as string) ?? "", sortOrder: Number(row.sort_order) });
    lessonsOf.set(row.qualification_id as string, list);
  }
  const courses: Course[] = rows.map((row) => {
    const requires = (row.requires_qualification_id as string | null) ?? null;
    return {
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
      requires: requires && nameOf.has(requires) ? { id: requires, name: nameOf.get(requires)! } : null,
      lessons: (lessonsOf.get(row.id as string) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    };
  });
  return sortByPrerequisite(courses);
}

/** Courses in the order they are taken: what a course requires comes before it; otherwise by name. */
export function sortByPrerequisite(courses: Course[]): Course[] {
  const byId = new Map(courses.map((course) => [course.id, course]));
  const depth = (course: Course, seen = new Set<string>()): number => {
    if (!course.requires || seen.has(course.id)) return 0;
    const before = byId.get(course.requires.id);
    if (!before) return 0;
    seen.add(course.id);
    return 1 + depth(before, seen);
  };
  return [...courses].sort((a, b) => depth(a) - depth(b) || a.name.localeCompare(b.name));
}

/** Each serving member's name, by id, as the fleet's records give it. */
async function fleetNames(supabase: Client): Promise<{ names: Record<string, string>; serving: Named[] }> {
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

export type Progress = { memberId: string; courseId: string; passed: number; lessons: number; complete: boolean; held: boolean; lastSignedAt: string };

const toProgress = (row: Row): Progress => ({
  memberId: row.member_id as string,
  courseId: row.qualification_id as string,
  passed: Number(row.passed),
  lessons: Number(row.lessons),
  complete: row.complete === true,
  held: row.held === true,
  lastSignedAt: row.last_signed_at as string,
});

type Outside = { state: "no-database" } | { state: "signed-out" } | { state: "no-record" } | { state: "outside" };

export type TrainingPage =
  | Outside
  | {
      state: "ready";
      member: Member;
      /** Whether the reader signs lessons off: an instructor, or an admin. */
      instructor: boolean;
      courses: Course[];
      /** The reader's own passes, by lesson. */
      mine: Map<string, Pass>;
      /** The qualifications the reader holds. */
      held: Set<string>;
      /** For an instructor: who has completed a course and awaits the award. */
      awaiting: (Progress & { course: Course })[];
      /** For an instructor: the chosen member's passes and awards, when one is chosen. */
      chosen: { member: Named; passes: Map<string, Pass>; held: Set<string> } | null;
      /** For an instructor: everyone serving, to choose from. */
      serving: Named[];
      names: Record<string, string>;
    };

/** The training page: the syllabus with the reader's own progress, and the instructor's tools for one. */
export async function getTraining(chosenId: string | null): Promise<TrainingPage> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  const member = session.member;
  if (!isServing(member)) return { state: "outside" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const instructor = member.roles.includes("instructor") || member.roles.includes("admin");

  const [courses, fleet, mine, awards] = await Promise.all([
    getSyllabus(supabase),
    fleetNames(supabase),
    supabase.from("lesson_passes").select("lesson_id, member_id, signed_by, signed_at, event_id").eq("member_id", member.id),
    supabase.from("qualification_awards").select("qualification_id").eq("member_id", member.id),
  ]);
  for (const result of [mine, awards]) {
    if (result.error) throw new Error(`The training record could not be read: ${result.error.message}`);
  }
  const page: Extract<TrainingPage, { state: "ready" }> = {
    state: "ready",
    member,
    instructor,
    courses,
    mine: new Map(((mine.data ?? []) as Row[]).map((row) => [row.lesson_id as string, toPass(row)])),
    held: new Set(((awards.data ?? []) as Row[]).map((row) => row.qualification_id as string)),
    awaiting: [],
    chosen: null,
    serving: [],
    names: fleet.names,
  };
  if (!instructor) return page;

  const courseOf = new Map(courses.map((course) => [course.id, course]));
  const [waiting, chosenPasses, chosenAwards] = await Promise.all([
    supabase.from("training_progress").select("member_id, qualification_id, passed, lessons, complete, held, last_signed_at").eq("complete", true).eq("held", false),
    chosenId ? supabase.from("lesson_passes").select("lesson_id, member_id, signed_by, signed_at, event_id").eq("member_id", chosenId) : Promise.resolve({ data: [], error: null }),
    chosenId ? supabase.from("qualification_awards").select("qualification_id").eq("member_id", chosenId) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [waiting, chosenPasses, chosenAwards]) {
    if (result.error) throw new Error(`The training record could not be read: ${result.error.message}`);
  }
  const servingIds = new Set(fleet.serving.map((person) => person.id));
  page.serving = fleet.serving.filter((person) => person.id !== member.id);
  page.awaiting = ((waiting.data ?? []) as Row[])
    .map(toProgress)
    .filter((line) => servingIds.has(line.memberId) && courseOf.has(line.courseId))
    .map((line) => ({ ...line, course: courseOf.get(line.courseId)! }))
    .sort((a, b) => a.lastSignedAt.localeCompare(b.lastSignedAt));
  const chosen = chosenId ? page.serving.find((person) => person.id === chosenId) : undefined;
  if (chosen) {
    page.chosen = {
      member: chosen,
      passes: new Map(((chosenPasses.data ?? []) as Row[]).map((row) => [row.lesson_id as string, toPass(row)])),
      held: new Set(((chosenAwards.data ?? []) as Row[]).map((row) => row.qualification_id as string)),
    };
  }
  return page;
}

/** A member's courses in progress, for their record: started and not yet held. */
export type TrainingLine = { course: string; passed: number; lessons: number; lines: { lesson: string; passedOn: string | null; signedBy: string | null }[] };

export async function getTrainingRecord(memberId: string): Promise<TrainingLine[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const [courses, passes, awards, roster] = await Promise.all([
    getSyllabus(supabase),
    supabase.from("lesson_passes").select("lesson_id, member_id, signed_by, signed_at, event_id").eq("member_id", memberId),
    supabase.from("qualification_awards").select("qualification_id").eq("member_id", memberId),
    supabase.from("roster").select("member_id, character_name, rank_name, acting"),
  ]);
  for (const result of [passes, awards, roster]) {
    if (result.error) throw new Error(`The training record could not be read: ${result.error.message}`);
  }
  const held = new Set(((awards.data ?? []) as Row[]).map((row) => row.qualification_id as string));
  const passOf = new Map(((passes.data ?? []) as Row[]).map((row) => [row.lesson_id as string, toPass(row)]));
  const names = new Map(
    ((roster.data ?? []) as Row[]).map((row) => [row.member_id as string, row.rank_name ? `${row.acting === true ? "Acting " : ""}${row.rank_name} ${row.character_name}` : (row.character_name as string)]),
  );
  return courses
    .filter((course) => !held.has(course.id) && course.lessons.some((lesson) => passOf.has(lesson.id)))
    .map((course) => ({
      course: course.name,
      passed: course.lessons.filter((lesson) => passOf.has(lesson.id)).length,
      lessons: course.lessons.length,
      lines: course.lessons.map((lesson) => {
        const pass = passOf.get(lesson.id);
        return { lesson: lesson.name, passedOn: pass?.signedAt ?? null, signedBy: pass?.signedBy ? (names.get(pass.signedBy) ?? "a former member") : null };
      }),
    }));
}
