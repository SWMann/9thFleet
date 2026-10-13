"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { typed } from "@/lib/application-form";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

/**
 * What command can do with a piracy report. Nothing here decides who may do
 * it. The database does: only command reads a report, marks it, or deletes
 * it, and nobody changes its words. Each action sends the change and passes
 * on the answer. When the answer is no, it also writes a line to the
 * activity log.
 */

export type ReportToolResult = { ok: boolean; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: ReportToolResult = { ok: false, message: "This site is not connected to the database yet." };
const NOT_THIS_PAGE = "That is not something this page can do.";
const NOTHING_CHANGED = "Nothing was changed. Command handles piracy reports, and this one may have been handled or deleted since the page was opened.";

/** The database client and the signed-in person's id, or a redirect to sign-in. */
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

/** Pass on what the database said to a change that should have touched one report. */
async function answer(
  session: Session,
  action: Attempt,
  result: { data: unknown[] | null; error: { code?: string; message: string } | null },
  words: { done: string; refusedAs: string },
): Promise<ReportToolResult> {
  if (result.error) return { ok: false, message: await turnedDown(session.supabase, action, result.error, explainRefusal(result.error, words.refusedAs)) };
  refresh();
  if (!result.data || result.data.length === 0) return { ok: false, message: await refused(session.supabase, action, NOTHING_CHANGED) };
  return { ok: true, message: words.done };
}

/** Mark a report handled or dismissed, with a word of what came of it. */
export async function closeReport(_previous: ReportToolResult, formData: FormData): Promise<ReportToolResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const decision = formData.get("decision");
  if (!id || (decision !== "handled" && decision !== "dismissed")) {
    return { ok: false, message: await refused(session.supabase, "report.close", NOT_THIS_PAGE) };
  }
  const note = typed(formData.get("note")).replace(/\s+/g, " ");
  if (note.length > 500) return { ok: false, message: "Keep the note under 500 characters." };

  // Only a report that still waits: a page left open does not close one that someone else has since closed.
  const result = await session.supabase.from("piracy_reports").update({ state: decision, outcome_note: note }).eq("id", id).eq("state", "new").select("id");
  return answer(session, "report.close", result, {
    done: decision === "handled" ? "Marked as handled." : "Dismissed.",
    refusedAs: "That could not be saved. Try again.",
  });
}

/** Put a handled or dismissed report back among those that wait. */
export async function reopenReport(_previous: ReportToolResult, formData: FormData): Promise<ReportToolResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "report.reopen", NOT_THIS_PAGE) };

  const result = await session.supabase.from("piracy_reports").update({ state: "new" }).eq("id", id).neq("state", "new").select("id");
  return answer(session, "report.reopen", result, { done: "Reopened.", refusedAs: "That could not be reopened. Try again." });
}

/** Delete a report for good. Its words go from the log of changes too. */
export async function deleteReport(_previous: ReportToolResult, formData: FormData): Promise<ReportToolResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "report.delete", NOT_THIS_PAGE) };

  const result = await session.supabase.from("piracy_reports").delete().eq("id", id).select("id");
  return answer(session, "report.delete", result, { done: "Deleted.", refusedAs: "That could not be deleted. Try again." });
}
