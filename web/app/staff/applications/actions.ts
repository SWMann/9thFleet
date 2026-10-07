"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { typed } from "@/lib/application-form";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

export type StaffResult = { ok: boolean; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOVES: Record<string, string> = {
  interview: "Moved to interview.",
  accepted: "Accepted. The applicant is now a recruit.",
  declined: "Declined.",
};

/** The database client and the signed-in person's id, or a redirect to sign-in. */
async function signedIn() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (!id) redirect("/sign-in");
  return { supabase, id };
}

/**
 * Move an application to interview, or accept or decline it.
 *
 * Nothing here checks who is asking. The database does: only staff can move an
 * application, never their own, and a closed one stays closed. It stamps the
 * decision with who made it, and accepting makes the applicant a recruit.
 */
export async function moveApplication(_previous: StaffResult, formData: FormData): Promise<StaffResult> {
  const session = await signedIn();
  if (!session) return { ok: false, message: "This site is not connected to the database yet." };

  const id = formData.get("id");
  const stage = formData.get("stage");
  if (typeof id !== "string" || !UUID.test(id) || typeof stage !== "string" || !(stage in MOVES)) {
    return { ok: false, message: "That is not something this page can do." };
  }

  const { data, error } = await session.supabase.from("applications").update({ stage }).eq("id", id).select("id");
  if (error) {
    return { ok: false, message: explainRefusal(error, "The application could not be changed. Try again.") };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "The application could not be found, or it is not yours to change." };
  }

  refresh();
  return { ok: true, message: MOVES[stage] };
}

/** Add an interview note, in the writer's own name. */
export async function addNote(_previous: StaffResult, formData: FormData): Promise<StaffResult> {
  const session = await signedIn();
  if (!session) return { ok: false, message: "This site is not connected to the database yet." };

  const id = formData.get("id");
  const body = typed(formData.get("body"));
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, message: "That application could not be found." };
  if (body === "") return { ok: false, message: "Write the note first." };
  if (body.length > 4000) return { ok: false, message: "Keep a note under 4,000 characters." };

  const { error } = await session.supabase
    .from("application_notes")
    .insert({ application_id: id, author_id: session.id, body });
  if (error) {
    return { ok: false, message: explainRefusal(error, "The note could not be saved. Only staff can write one, and not on their own application.") };
  }

  refresh();
  return { ok: true, message: "Saved." };
}

/** Remove a note. The database lets its author or an admin do that, and nobody else. */
export async function deleteNote(formData: FormData) {
  const session = await signedIn();
  const id = formData.get("id");
  if (!session || typeof id !== "string" || !UUID.test(id)) return;

  const { error } = await session.supabase.from("application_notes").delete().eq("id", id);
  if (error) throw new Error(`The note could not be removed: ${error.message}`);
  refresh();
}

/** Open or close recruitment. The database lets an admin do that, and nobody else. */
export async function setRecruitment(formData: FormData) {
  const session = await signedIn();
  if (!session) return;

  const open = formData.get("open") === "true";
  const { error } = await session.supabase.from("fleet_settings").update({ recruitment_open: open }).eq("id", true);
  if (error) throw new Error(`Recruitment could not be changed: ${error.message}`);
  refresh();
}
