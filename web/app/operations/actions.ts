"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { typed } from "@/lib/application-form";
import { kinds, paragraphs, returnedNames, weapons } from "@/lib/operations-form";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

/**
 * What a member can do to an event. Nothing here decides who may do it. The
 * database does: who drafts and runs an event, when the roll closes, who may
 * stand in for which post, and when a return or a report can be made. Each
 * action sends the change and passes on the database's answer. When the answer
 * is no, it also writes a line to the activity log.
 */

export type OpsResult = { ok: boolean; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: OpsResult = { ok: false, message: "This site is not connected to the database yet." };
const NOT_THIS_PAGE: OpsResult = { ok: false, message: "That is not something this page can do." };

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

/** A form sent something its page never offers. That is worth a line in the log. */
const notThisPage = async (session: Session, action: Attempt): Promise<OpsResult> => ({
  ok: false,
  message: await refused(session.supabase, action, NOT_THIS_PAGE.message),
});
/** The database answered with an error: log it and say what the person is told. */
const failed = async (session: Session, action: Attempt, error: { code?: string; message: string }, shown: string): Promise<OpsResult> => ({
  ok: false,
  message: await turnedDown(session.supabase, action, error, shown),
});
/** The change matched nothing, because the access rules hid the row. */
const notYours = async (session: Session, action: Attempt, shown: string): Promise<OpsResult> => ({
  ok: false,
  message: await refused(session.supabase, action, shown),
});

/** The event's fields from the form, or a message saying what is wrong with them. */
function readEvent(formData: FormData): { fields: Record<string, string | number | null> } | { problem: string } {
  const kind = formData.get("kind");
  if (typeof kind !== "string" || !kinds.some((entry) => entry.key === kind)) return { problem: "Choose the type of event." };

  const title = typed(formData.get("title")).replace(/\s+/g, " ");
  if (title.length < 3 || title.length > 80) return { problem: "Give the event a title of 3 to 80 characters." };
  const summary = typed(formData.get("summary")).replace(/\s+/g, " ");
  if (summary.length > 200) return { problem: "Keep the summary under 200 characters." };
  const fallback = typed(formData.get("pve_fallback")).replace(/\s+/g, " ");
  if (fallback.length > 200) return { problem: "Keep the fallback under 200 characters." };

  const date = formData.get("date");
  const time = formData.get("time");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
    return { problem: "Give the date and the time it starts, in UTC." };
  }
  const startsAt = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(startsAt.getTime())) return { problem: "That date or time does not exist." };

  const duration = Number(formData.get("duration"));
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    return { problem: "Give the length in minutes, from 15 to 480." };
  }

  const commander = uuid(formData.get("commander"));
  if (!commander) return { problem: "Name the operation commander." };
  const second = uuid(formData.get("second"));
  if (second && second === commander) return { problem: "The second-in-command is someone other than the commander." };

  const weaponsState = formData.get("weapons_state");
  return {
    fields: {
      kind,
      title,
      summary,
      starts_at: startsAt.toISOString(),
      duration_minutes: duration,
      commander_id: commander,
      second_id: second,
      observer_id: uuid(formData.get("observer")),
      weapons_state: weapons.some((entry) => entry.key === weaponsState) ? String(weaponsState) : null,
      pve_fallback: fallback,
    },
  };
}

/** Draft an event. It is seen only by the people working on it until it is announced. */
export async function createEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const read = readEvent(formData);
  if ("problem" in read) return { ok: false, message: read.problem };

  const { data, error } = await session.supabase.from("events").insert(read.fields).select("id").single();
  if (error) {
    return failed(
      session,
      "event.draft",
      error,
      explainRefusal(error, "The event could not be drafted. Command drafts events, and instructors draft training."),
    );
  }
  if (!data) return { ok: false, message: "The event could not be drafted. Try again." };
  redirect(`/operations/${data.id}`);
}

/** Change an event's details. */
export async function updateEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.change");
  const read = readEvent(formData);
  if ("problem" in read) return { ok: false, message: read.problem };

  const { data, error } = await session.supabase.from("events").update(read.fields).eq("id", id).select("id");
  if (error) return failed(session, "event.change", error, explainRefusal(error, "The event could not be changed. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.change", "This event is not yours to change.");
  refresh();
  return { ok: true, message: "Saved." };
}

/** Write the warning order and the operation order. */
export async function saveOrders(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.orders");

  const orders: Record<string, string> = { warning_order: typed(formData.get("warning_order")) };
  if (orders.warning_order.length > 4000) return { ok: false, message: "Keep the warning order under 4,000 characters." };
  for (const paragraph of paragraphs) {
    const text = typed(formData.get(paragraph.key));
    if (text.length > paragraph.max) {
      return { ok: false, message: `Keep "${paragraph.name}" under ${paragraph.max.toLocaleString("en-GB")} characters.` };
    }
    orders[paragraph.key] = text;
  }

  const { data, error } = await session.supabase.from("event_orders").update(orders).eq("event_id", id).select("event_id");
  if (error) return failed(session, "event.orders", error, explainRefusal(error, "The orders could not be saved. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.orders", "These orders are not yours to write.");
  refresh();
  return { ok: true, message: "Saved." };
}

const MOVES: Record<string, string> = {
  announced: "Announced. The fleet can see it and reply.",
  cancelled: "Cancelled.",
};

/** Announce a draft, or cancel an event. */
export async function moveEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const state = formData.get("state");
  if (!id || typeof state !== "string" || !(state in MOVES)) return notThisPage(session, "event.move");

  const { data, error } = await session.supabase.from("events").update({ state }).eq("id", id).select("id");
  if (error) return failed(session, "event.move", error, explainRefusal(error, "The event could not be changed. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.move", "This event is not yours to change.");
  refresh();
  return { ok: true, message: MOVES[state] };
}

/** Delete a draft that will not be used. */
export async function deleteDraft(formData: FormData) {
  const session = await signedIn();
  const id = uuid(formData.get("id"));
  if (!session || !id) return;
  const { data, error } = await session.supabase.from("events").delete().eq("id", id).select("id");
  if (error) {
    await turnedDown(session.supabase, "event.delete", error, "The draft could not be deleted.");
    throw new Error(`The draft could not be deleted: ${error.message}`);
  }
  if (!data || data.length === 0) {
    await refused(session.supabase, "event.delete", "Nothing was deleted. Only a draft can be, by its author or command.");
  }
  redirect("/operations");
}

/** The member's own line on an event's roll, if they have one. */
async function lineOf(session: Session, eventId: string, memberId: string) {
  return session.supabase
    .from("attendance")
    .select("member_id")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .maybeSingle();
}

/** Say whether you are attending. It can be changed until the roll closes. */
export async function replyToEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const reply = formData.get("reply");
  if (!id || (reply !== "attending" && reply !== "not_attending")) return notThisPage(session, "event.reply");

  const existing = await lineOf(session, id, session.id);
  if (existing.error) return failed(session, "event.reply", existing.error, "Your reply could not be saved. Try again.");
  const { error } = existing.data
    ? await session.supabase.from("attendance").update({ reply }).eq("event_id", id).eq("member_id", session.id)
    : await session.supabase.from("attendance").insert({ event_id: id, member_id: session.id, reply });
  if (error) return failed(session, "event.reply", error, explainRefusal(error, "Your reply could not be saved. Try again."));
  refresh();
  return { ok: true, message: reply === "attending" ? "You are down as attending." : "You are down as not attending." };
}

/**
 * Put someone in a post for the night, or take them out of it. With no member
 * named it is the person asking, standing in for an empty entry post.
 */
export async function setStandIn(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const position = formData.get("position");
  const post = position === "" ? null : uuid(position);
  if (!id || (position !== "" && !post)) return notThisPage(session, "event.stand-in");
  const named = formData.get("member");
  const member = named === null ? session.id : uuid(named);
  if (!member) return { ok: false, message: "Choose who stands in." };

  const { data, error } = await session.supabase
    .from("attendance")
    .update({ stand_in_position_id: post })
    .eq("event_id", id)
    .eq("member_id", member)
    .select("member_id");
  if (error) {
    const shown =
      error.code === "23505" ? "Someone already stands in for that post." : explainRefusal(error, "That could not be done. Try again.");
    return failed(session, "event.stand-in", error, shown);
  }
  if (!data || data.length === 0) {
    return notYours(session, "event.stand-in", "Only someone who has replied that they are attending can stand in.");
  }
  refresh();
  if (!post) return { ok: true, message: "Taken out of the post." };
  return { ok: true, message: member === session.id ? "You are standing in for that post." : "Placed." };
}

/**
 * Make the attendance return: mark everyone present or absent, then close the
 * event. The return is kept apart from the roll, because who was absent is not
 * for the whole fleet to read.
 */
export async function fileReturn(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.return");

  const marks: { member: string; returned: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("returned:")) continue;
    const member = uuid(key.slice("returned:".length));
    if (!member || typeof value !== "string" || !(value in returnedNames)) return notThisPage(session, "event.return");
    marks.push({ member, returned: value });
  }
  if (marks.length === 0) return { ok: false, message: "There is nobody on the roll to mark." };

  const existing = await session.supabase.from("attendance_returns").select("member_id").eq("event_id", id);
  if (existing.error) return failed(session, "event.return", existing.error, "The return could not be saved. Try again.");
  const have = new Set((existing.data ?? []).map((line) => line.member_id));

  for (const mark of marks) {
    const { error } = have.has(mark.member)
      ? await session.supabase
          .from("attendance_returns")
          .update({ returned: mark.returned })
          .eq("event_id", id)
          .eq("member_id", mark.member)
      : await session.supabase
          .from("attendance_returns")
          .insert({ event_id: id, member_id: mark.member, returned: mark.returned });
    if (error) {
      const shown = explainRefusal(error, "The return could not be saved. Only whoever ran the event makes it.");
      return failed(session, "event.return", error, shown);
    }
  }

  // Closing is refused once the event is already done, which is fine: the return was a correction.
  const closed = await session.supabase.from("events").update({ state: "done" }).eq("id", id).eq("state", "announced");
  if (closed.error) {
    const shown = explainRefusal(closed.error, "The return was saved, but the event could not be closed.");
    return failed(session, "event.return", closed.error, shown);
  }
  refresh();
  return { ok: true, message: "The attendance return is made." };
}

/** File the after-action report, or correct it. */
export async function fileReport(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.report");

  const report = {
    what_happened: typed(formData.get("what_happened")),
    to_keep: typed(formData.get("to_keep")),
    to_change: typed(formData.get("to_change")),
  };
  if (report.what_happened === "") return { ok: false, message: "Say what happened first." };
  if (report.what_happened.length > 6000) return { ok: false, message: 'Keep "What happened" under 6,000 characters.' };
  if (report.to_keep.length > 4000 || report.to_change.length > 4000) {
    return { ok: false, message: "Keep each of the other answers under 4,000 characters." };
  }

  const existing = await session.supabase.from("after_action_reports").select("event_id").eq("event_id", id).maybeSingle();
  if (existing.error) return failed(session, "event.report", existing.error, "The report could not be saved. Try again.");
  const { error } = existing.data
    ? await session.supabase.from("after_action_reports").update(report).eq("event_id", id)
    : await session.supabase.from("after_action_reports").insert({ event_id: id, ...report });
  if (error) {
    const shown = explainRefusal(error, "The report could not be saved. Only whoever ran the event files it.");
    return failed(session, "event.report", error, shown);
  }
  refresh();
  return { ok: true, message: "The after-action report is filed." };
}
