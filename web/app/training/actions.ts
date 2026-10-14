"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";
import { readLesson } from "@/lib/training-form";

/**
 * What an instructor does with training records, and what command does with
 * the syllabus. Nothing here decides who may: the database does. An
 * instructor signs a lesson off in their own name, withdraws their own
 * sign-off until the award, and awards a qualification once every lesson is
 * passed. Command edits the lessons of each course and what it requires.
 */

/** `stamp` is set when something was saved, so a form can start afresh; `at` says when the answer came, so the latest of several is shown. */
export type TrainingResult = { ok: boolean; message: string; stamp?: number; at?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: TrainingResult = { ok: false, message: "This site is not connected to the database yet." };
const NOT_THIS_PAGE = "That is not something this page can do.";

async function signedIn() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");
  return { supabase, id };
}
type Session = NonNullable<Awaited<ReturnType<typeof signedIn>>>;

const uuid = (value: FormDataEntryValue | null) => (typeof value === "string" && UUID.test(value) ? value : null);
const uuids = (formData: FormData, name: string) => formData.getAll(name).map(uuid).filter((value): value is string => value !== null);
const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const notThisPage = async (session: Session, action: Attempt): Promise<TrainingResult> => ({ ok: false, message: await refused(session.supabase, action, NOT_THIS_PAGE), at: Date.now() });
const no = (message: string): TrainingResult => ({ ok: false, message, at: Date.now() });
const yes = (message: string): TrainingResult => ({ ok: true, message, stamp: Date.now(), at: Date.now() });

/** Sign off the ticked lessons for one member, one to one. Each pass is in the instructor's own name. */
export async function signOffLessons(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const member = uuid(formData.get("member"));
  if (!member) return notThisPage(session, "training.sign-off");
  const lessons = uuids(formData, "lesson");
  if (lessons.length === 0) return no("Tick a lesson first.");

  let signed = 0;
  for (const lesson of lessons) {
    const { error } = await session.supabase.from("lesson_passes").insert({ lesson_id: lesson, member_id: member });
    // One already signed off has nothing more to be signed.
    if (error?.code === "23505") continue;
    if (error) {
      if (signed > 0) refresh();
      return no(await turnedDown(session.supabase, "training.sign-off", error, explainRefusal(error, "That could not be signed off. Only an instructor signs off a lesson, and never their own.")));
    }
    signed += 1;
  }
  refresh();
  return yes(signed === 0 ? "Already signed off." : signed === 1 ? "1 lesson signed off." : `${signed} lessons signed off.`);
}

/** Withdraw the instructor's own sign-off of one lesson for one member. The database allows it until the award. */
export async function withdrawPass(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const member = uuid(formData.get("member"));
  const lesson = uuid(formData.get("withdraw"));
  if (!member || !lesson) return notThisPage(session, "training.withdraw");
  const gone = await session.supabase.from("lesson_passes").delete().eq("member_id", member).eq("lesson_id", lesson).select("id");
  if (gone.error) return no(await turnedDown(session.supabase, "training.withdraw", gone.error, explainRefusal(gone.error, "That sign-off could not be withdrawn.")));
  if (!gone.data || gone.data.length === 0) {
    return no(await refused(session.supabase, "training.withdraw", "Only the instructor who signed a lesson off withdraws it, and only until the qualification is awarded."));
  }
  refresh();
  return yes("Sign-off withdrawn.");
}

/** Award a qualification to a member who has passed every lesson of its course, in the instructor's own name. */
export async function awardQualification(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const member = uuid(formData.get("member"));
  const course = uuid(formData.get("course"));
  if (!member || !course) return notThisPage(session, "training.award");
  const { error } = await session.supabase.from("qualification_awards").insert({ member_id: member, qualification_id: course, awarded_by: session.id });
  if (error?.code === "23505") return no("They hold it already.");
  if (error) {
    return no(await turnedDown(session.supabase, "training.award", error, explainRefusal(error, "That could not be awarded. Only an instructor awards a qualification, never their own, and only once every lesson is signed off.")));
  }
  refresh();
  return yes("Awarded.");
}

/** Command: what a course requires first, or nothing. */
export async function saveRequires(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const course = uuid(formData.get("course"));
  if (!course) return notThisPage(session, "training.syllabus");
  const requires = uuid(formData.get("requires"));
  if (requires === course) return { ok: false, message: "A course cannot require itself." };
  const saved = await session.supabase.from("qualifications").update({ requires_qualification_id: requires }).eq("id", course).select("id");
  if (saved.error) return { ok: false, message: await turnedDown(session.supabase, "training.syllabus", saved.error, explainRefusal(saved.error, "That could not be saved. Command sets what a course requires.")) };
  if (!saved.data || saved.data.length === 0) return { ok: false, message: await refused(session.supabase, "training.syllabus", "That could not be saved. Command sets what a course requires.") };
  refresh();
  return { ok: true, message: "Saved.", stamp: Date.now() };
}

/** Command: add a lesson to a course, or change one. */
export async function saveLesson(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const course = uuid(formData.get("course"));
  const lesson = uuid(formData.get("lesson"));
  if (!course) return notThisPage(session, "training.syllabus");
  const read = readLesson((name) => text(formData.get(name)));
  if ("problem" in read) return { ok: false, message: read.problem };
  const saved = lesson
    ? await session.supabase.from("lessons").update(read.fields).eq("id", lesson).eq("qualification_id", course).select("id")
    : await session.supabase.from("lessons").insert({ ...read.fields, qualification_id: course }).select("id");
  if (saved.error) {
    const shown = saved.error.code === "23505" ? "This course already has a lesson of that name." : explainRefusal(saved.error, "That could not be saved. Command edits the syllabus.");
    return { ok: false, message: await turnedDown(session.supabase, "training.syllabus", saved.error, shown) };
  }
  if (!saved.data || saved.data.length === 0) return { ok: false, message: await refused(session.supabase, "training.syllabus", "That could not be saved. Command edits the syllabus.") };
  refresh();
  return { ok: true, message: lesson ? "Saved." : "Lesson added.", stamp: Date.now() };
}

/** Command: remove a lesson nobody has passed. */
export async function deleteLesson(_previous: TrainingResult, formData: FormData): Promise<TrainingResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const lesson = uuid(formData.get("lesson"));
  if (!lesson) return notThisPage(session, "training.syllabus");
  const gone = await session.supabase.from("lessons").delete().eq("id", lesson).select("id");
  if (gone.error) {
    // 23503 and 23001 are both a foreign key saying no.
    const shown = gone.error.code === "23503" || gone.error.code === "23001" ? "Someone has passed this lesson, so it stays on the syllabus. Rename it or move it instead." : explainRefusal(gone.error, "That could not be removed. Command edits the syllabus.");
    return { ok: false, message: await turnedDown(session.supabase, "training.syllabus", gone.error, shown) };
  }
  if (!gone.data || gone.data.length === 0) return { ok: false, message: await refused(session.supabase, "training.syllabus", "That could not be removed. Command edits the syllabus.") };
  refresh();
  return { ok: true, message: "Lesson removed.", stamp: Date.now() };
}
