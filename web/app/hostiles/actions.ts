"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { typed } from "@/lib/application-form";
import { STANDS_FOR, readHostile, readWords } from "@/lib/hostile-form";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

/**
 * What a member can do to the hostile list. Nothing here decides who may do
 * it. The database does: any serving member puts a name forward, only command
 * lists, declines, renews and lifts, and the day an entry lapses is the
 * database's to set. Each action sends the change and passes on the answer.
 * When the answer is no, it also writes a line to the activity log.
 */

export type HostileResult = {
  ok: boolean;
  message: string;
  /** What was typed, given back when it was not saved, so that the form keeps it. */
  values?: Record<string, string>;
  /** Changes each time the form is given back, so that it is drawn afresh. */
  stamp?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: HostileResult = { ok: false, message: "This site is not connected to the database yet." };

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

/** What was typed into a form, to hand back when the save is turned down. */
function typedInto(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

/** A change to one entry, and what to say when the database, or its access rules, said no. */
async function changeEntry(
  session: Session,
  action: Attempt,
  id: string,
  change: Record<string, string>,
  words: { done: string; refusedAs: string; notYours: string },
): Promise<HostileResult> {
  const { data, error } = await session.supabase.from("hostiles").update(change).eq("id", id).select("id");
  if (error) return { ok: false, message: await turnedDown(session.supabase, action, error, explainRefusal(error, words.refusedAs)) };
  if (!data || data.length === 0) return { ok: false, message: await refused(session.supabase, action, words.notYours) };
  refresh();
  return { ok: true, message: words.done };
}

const COMMAND_ONLY = "Nothing was changed. Command keeps the hostile list.";

/**
 * Put a name forward. A member's goes to command to decide. Command may list
 * a name outright, which the database allows command and nobody else.
 */
export async function proposeHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const again = { values: typedInto(formData), stamp: Date.now() };

  const read = readHostile((name) => typed(formData.get(name)));
  if ("problem" in read) return { ok: false, message: read.problem, ...again };
  const outright = formData.get("outright") === "on";

  const { error } = await session.supabase.from("hostiles").insert({ ...read.fields, state: outright ? "listed" : "proposed" });
  if (error) {
    const shown =
      error.code === "23505"
        ? `${read.fields.handle} already has an entry that is waiting or listed.`
        : explainRefusal(error, "That could not be put forward. Only a serving member puts a name forward.");
    return { ok: false, message: await turnedDown(session.supabase, "hostile.propose", error, shown), ...again };
  }

  refresh();
  return {
    ok: true,
    message: outright ? `${read.fields.handle} is on the list.` : `${read.fields.handle} is put forward. Command decides whether it is listed.`,
    stamp: Date.now(),
  };
}

/** List or decline a name that was put forward. */
export async function decideHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const decision = formData.get("decision");
  const level = formData.get("level");
  const note = typed(formData.get("note")).replace(/\s+/g, " ");
  if (!id || (decision !== "listed" && decision !== "declined") || (decision === "listed" && level !== "hostile" && level !== "watch")) {
    return { ok: false, message: await refused(session.supabase, "hostile.decide", "That is not something this page can do.") };
  }
  if (note.length > 500) return { ok: false, message: "Keep the note under 500 characters." };

  return changeEntry(
    session,
    "hostile.decide",
    id,
    decision === "listed" ? { state: "listed", level: level as string, decision_note: note } : { state: "declined", decision_note: note },
    {
      done: decision === "listed" ? (level === "watch" ? "Listed, on watch." : "Listed as hostile.") : "Declined.",
      refusedAs: "That could not be decided. Try again.",
      notYours: COMMAND_ONLY,
    },
  );
}

/** Renew an entry for another 90 days. The database sets the day, whatever is sent. */
export async function renewHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "hostile.renew", "That is not something this page can do.") };
  const until = new Date(Date.now() + STANDS_FOR * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return changeEntry(session, "hostile.renew", id, { expires_on: until }, {
    done: `Renewed for ${STANDS_FOR} days.`,
    refusedAs: "That could not be renewed. Try again.",
    notYours: COMMAND_ONLY,
  });
}

/** Move a listed entry between hostile and watch. */
export async function moveHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const level = formData.get("level");
  if (!id || (level !== "hostile" && level !== "watch")) {
    return { ok: false, message: await refused(session.supabase, "hostile.level", "That is not something this page can do.") };
  }
  return changeEntry(session, "hostile.level", id, { level }, {
    done: level === "watch" ? "Moved to watch." : "Made hostile.",
    refusedAs: "That could not be moved. Try again.",
    notYours: COMMAND_ONLY,
  });
}

/** Lift a listed entry, with a word of why. */
export async function liftHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const note = typed(formData.get("note")).replace(/\s+/g, " ");
  if (!id) return { ok: false, message: await refused(session.supabase, "hostile.lift", "That is not something this page can do.") };
  if (note.length > 500) return { ok: false, message: "Keep the note under 500 characters." };
  return changeEntry(session, "hostile.lift", id, { state: "lifted", decision_note: note }, {
    done: "Lifted. It is off the list.",
    refusedAs: "That could not be lifted. Try again.",
    notYours: COMMAND_ONLY,
  });
}

/** Rewrite what an entry says: the name it is known by, what happened and the evidence. */
export async function rewordHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const again = { values: typedInto(formData), stamp: Date.now() };
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "hostile.reword", "That is not something this page can do."), ...again };
  const name = typed(formData.get("name")).replace(/\s+/g, " ");
  if (name.length > 80) return { ok: false, message: "Keep the name under 80 characters.", ...again };
  const words = readWords((field) => typed(formData.get(field)));
  if ("problem" in words) return { ok: false, message: words.problem, ...again };

  const result = await changeEntry(session, "hostile.reword", id, { name, ...words.fields }, {
    done: "Saved.",
    refusedAs: "That could not be saved. Try again.",
    notYours: COMMAND_ONLY,
  });
  return result.ok ? { ...result, stamp: Date.now() } : { ...result, ...again };
}

/** Take back a name the member put forward themselves, while it still waits. */
export async function withdrawHostile(_previous: HostileResult, formData: FormData): Promise<HostileResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return { ok: false, message: await refused(session.supabase, "hostile.withdraw", "That is not something this page can do.") };

  const { data, error } = await session.supabase.from("hostiles").delete().eq("id", id).select("id");
  if (error) {
    const shown = explainRefusal(error, "That could not be taken back. Try again.");
    return { ok: false, message: await turnedDown(session.supabase, "hostile.withdraw", error, shown) };
  }
  if (!data || data.length === 0) {
    const shown = "Nothing was taken back. A name is taken back by whoever put it forward, and only while it waits.";
    return { ok: false, message: await refused(session.supabase, "hostile.withdraw", shown) };
  }
  refresh();
  return { ok: true, message: "Taken back." };
}
