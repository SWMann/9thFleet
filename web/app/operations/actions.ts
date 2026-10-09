"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { typed } from "@/lib/application-form";
import {
  aWeekOn,
  minutesFromStart,
  nextTitle,
  outcomeNames,
  paragraphs,
  planPartOf,
  returnedNames,
  serviceNames,
  weapons,
  type PlanPart,
} from "@/lib/operations-form";
import { announceOnDiscord } from "@/lib/discord";
import { originOf } from "@/lib/origin";
import { explainRefusal } from "@/lib/refusals";
import { createClient } from "@/lib/supabase/server";

/**
 * What a member can do to an event. Nothing here decides who may do it. The
 * database does: who drafts and runs an event, when the roll closes, who may
 * stand in for which post, and when a return or a report can be made. Each
 * action sends the change and passes on the database's answer. When the answer
 * is no, it also writes a line to the activity log.
 */

export type OpsResult = {
  ok: boolean;
  message: string;
  /** Somewhere to go next, such as the draft that closing a weekly event left. */
  link?: { href: string; label: string };
  /** When a save is turned down, what was typed, so the form can show it again. */
  values?: Record<string, string>;
  /** When the answer was given. A form draws itself afresh for each answer. */
  stamp?: number;
};

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

const SERVING = ["recruit", "auxiliary", "member", "reserve"];
const TYPE_KEY = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/** What was typed into a form, to hand back when the save is turned down. */
function typedInto(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

/** The event's fields from the form, or a message saying what is wrong with them. */
function readEvent(formData: FormData): { fields: Record<string, string | number | boolean | null> } | { problem: string } {
  // Which types exist, and who may draft each, is the database's to say.
  const kind = formData.get("kind");
  if (typeof kind !== "string" || kind.length > 40 || !TYPE_KEY.test(kind)) return { problem: "Choose the type of event." };

  const title = typed(formData.get("title")).replace(/\s+/g, " ");
  if (title.length < 3 || title.length > 80) return { problem: "Give the event a title of 3 to 80 characters." };
  const summary = typed(formData.get("summary")).replace(/\s+/g, " ");
  if (summary.length > 200) return { problem: "Keep the summary under 200 characters." };
  const fallback = typed(formData.get("pve_fallback")).replace(/\s+/g, " ");
  if (fallback.length > 200) return { problem: "Keep the fallback under 200 characters." };
  const musterAt = typed(formData.get("muster_at")).replace(/\s+/g, " ");
  const area = typed(formData.get("area")).replace(/\s+/g, " ");
  if (musterAt.length > 120 || area.length > 120) return { problem: "Keep the muster point and the area under 120 characters each." };

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

  // A number that may be left empty: how many places, and how many must attend.
  const count = (name: string): number | null | "bad" => {
    const text = typed(formData.get(name));
    if (text === "") return null;
    const value = Number(text);
    return Number.isInteger(value) && value >= 1 && value <= 500 ? value : "bad";
  };
  const places = count("places");
  if (places === "bad") return { problem: "Give the number of places as a whole number from 1 to 500, or leave it empty." };
  const minimum = count("minimum_attending");
  if (minimum === "bad") return { problem: "Give the minimum as a whole number from 1 to 500, or leave it empty." };
  if (places !== null && minimum !== null && minimum > places) {
    return { problem: "The minimum cannot be more than the number of places." };
  }
  const service = formData.get("open_to_service");

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
      repeats_weekly: formData.get("repeats_weekly") === "on",
      open_to_recruits: formData.get("open_to_recruits") === "on",
      open_to_service: typeof service === "string" && service in serviceNames ? service : null,
      requires_qualification_id: uuid(formData.get("requires_qualification")),
      teaches_qualification_id: uuid(formData.get("teaches_qualification")),
      places,
      minimum_attending: minimum,
      muster_at: musterAt,
      area,
    },
  };
}

/** What to say when the database turns down an event's details. */
function explainEvent(error: { code?: string; message: string }, otherwise: string): string {
  if (error.code === "23503" && /events_kind_fkey/.test(error.message)) return "That type of event is no longer there. Choose another.";
  return explainRefusal(error, otherwise);
}

/** Draft an event. It is seen only by the people working on it until it is announced. */
export async function createEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const again = { values: typedInto(formData), stamp: Date.now() };
  const read = readEvent(formData);
  if ("problem" in read) return { ok: false, message: read.problem, ...again };

  const { data, error } = await session.supabase.from("events").insert(read.fields).select("id").single();
  if (error) {
    const shown = explainEvent(error, "The event could not be drafted. Command drafts events, and instructors draft the types open to them.");
    return { ...(await failed(session, "event.draft", error, shown)), ...again };
  }
  if (!data) return { ok: false, message: "The event could not be drafted. Try again.", ...again };
  redirect(`/operations/${data.id}`);
}

/**
 * Draft another event like this one: the same type, details and orders, at the
 * same time of the week, the next one that has not gone by. The database copies
 * the orders, the plan, the units, the extra posts and the posts that must be
 * filled, and only for someone who can read the event.
 */
export async function copyEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.copy");

  const [source, roster] = await Promise.all([
    session.supabase
      .from("events")
      .select(
        "kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id, weapons_state, pve_fallback, open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending, muster_at, area, reading, teaches_qualification_id",
      )
      .eq("id", id)
      .maybeSingle(),
    session.supabase.from("roster").select("member_id, status"),
  ]);
  const unread = source.error ?? roster.error;
  if (unread) return failed(session, "event.copy", unread, "The event could not be read. Try again.");
  if (!source.data) return notYours(session, "event.copy", "That event is not there to copy.");

  // Someone who has left since cannot be named again. The person copying commands it until they name someone.
  const serving = new Set((roster.data ?? []).filter((row) => SERVING.includes(row.status as string)).map((row) => row.member_id as string));
  const still = (member: unknown) => (typeof member === "string" && serving.has(member) ? member : null);
  const event = source.data;
  const commander = still(event.commander_id) ?? session.id;
  const second = still(event.second_id);

  const { data, error } = await session.supabase
    .from("events")
    .insert({
      kind: event.kind,
      title: nextTitle(event.title as string),
      summary: event.summary,
      starts_at: aWeekOn(event.starts_at as string, Date.now()),
      duration_minutes: event.duration_minutes,
      commander_id: commander,
      second_id: second === commander ? null : second,
      observer_id: still(event.observer_id),
      weapons_state: event.weapons_state,
      pve_fallback: event.pve_fallback,
      open_to_recruits: event.open_to_recruits,
      open_to_service: event.open_to_service,
      requires_qualification_id: event.requires_qualification_id,
      places: event.places,
      minimum_attending: event.minimum_attending,
      muster_at: event.muster_at,
      area: event.area,
      reading: event.reading,
      teaches_qualification_id: event.teaches_qualification_id,
      copied_from: id,
    })
    .select("id")
    .single();
  if (error) {
    const shown = explainEvent(error, "The event could not be copied. Command drafts events, and instructors draft the types open to them.");
    return failed(session, "event.copy", error, shown);
  }
  if (!data) return { ok: false, message: "The event could not be copied. Try again." };
  redirect(`/operations/${data.id}/edit`);
}

/** The draft that closing or cancelling a weekly event left for next week, if it left one. */
async function nextWeeks(session: Session, id: string): Promise<OpsResult["link"]> {
  const { data } = await session.supabase
    .from("events")
    .select("id, title")
    .eq("copied_from", id)
    .eq("state", "draft")
    .is("repeats_weekly", true)
    .limit(1);
  const next = data?.[0];
  return next ? { href: `/operations/${next.id}`, label: `Next week's is drafted: ${next.title}` } : undefined;
}

/** Change an event's details. */
export async function updateEvent(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.change");
  const again = { values: typedInto(formData), stamp: Date.now() };
  const read = readEvent(formData);
  if ("problem" in read) return { ok: false, message: read.problem, ...again };

  const { data, error } = await session.supabase.from("events").update(read.fields).eq("id", id).select("id");
  if (error) {
    return { ...(await failed(session, "event.change", error, explainEvent(error, "The event could not be changed. Try again."))), ...again };
  }
  if (!data || data.length === 0) return { ...(await notYours(session, "event.change", "This event is not yours to change.")), ...again };
  refresh();
  return { ok: true, message: "Saved.", stamp: again.stamp };
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
      return { ok: false, message: `One section of the orders is too long. It holds up to ${paragraph.max.toLocaleString("en-GB")} characters.` };
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
  if (state === "cancelled") return { ok: true, message: MOVES[state], link: await nextWeeks(session, id) };
  return { ok: true, message: `${MOVES[state]}${await tellDiscord(session, id)}` };
}

/**
 * Post the announcement to the fleet's Discord channel, if one is set up. It
 * carries the type, the title, the time and a link, and none of the orders.
 * Returns what to add to the answer the person is given.
 */
async function tellDiscord(session: Session, id: string): Promise<string> {
  const [event, types] = await Promise.all([
    session.supabase.from("events").select("kind, title, starts_at").eq("id", id).maybeSingle(),
    session.supabase.from("event_types").select("key, name"),
  ]);
  const found = event.data;
  if (!found) return "";
  const type = (types.data ?? []).find((entry) => entry.key === found.kind)?.name as string | undefined;
  const origin = originOf(await headers());
  const posted = await announceOnDiscord({
    type: type ?? "Event",
    title: found.title as string,
    startsAt: found.starts_at as string,
    link: `${origin}/operations/${id}`,
  });
  if (posted === "off") return "";
  if (posted === "posted") return " It has been posted to Discord.";
  await turnedDown(session.supabase, "event.discord", { message: "The Discord webhook did not accept the post." }, "It could not be posted to Discord.");
  return " It could not be posted to Discord, so tell the fleet yourself.";
}

const APPROVALS: Record<string, string> = {
  asked: "Command has been asked to approve it.",
  not_asked: "The request has been taken back.",
  approved: "Approved. It can now be announced.",
};

/** Ask command to approve a draft, take the request back, or as command give the approval. */
export async function setApproval(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const approval = formData.get("approval");
  if (!id || typeof approval !== "string" || !(approval in APPROVALS)) return notThisPage(session, "event.approval");

  const { data, error } = await session.supabase.from("events").update({ approval }).eq("id", id).select("id");
  if (error) return failed(session, "event.approval", error, explainRefusal(error, "That could not be done. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.approval", "This event is not yours to change.");
  refresh();
  return { ok: true, message: APPROVALS[approval] };
}

const OPFOR_IS_COMMANDS = "Only command sets up an opposing force.";

/** Write the opposing force's plan. Command and whoever leads it can. */
export async function saveOpforPlan(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.opfor");
  const again = { values: typedInto(formData), stamp: Date.now() };
  const plan = typed(formData.get("plan"));
  if (plan.length > 6000) return { ok: false, message: "Keep the plan under 6,000 characters.", ...again };

  const existing = await session.supabase.from("event_opfor").select("event_id").eq("event_id", id).maybeSingle();
  if (existing.error) return { ...(await failed(session, "event.opfor", existing.error, "The plan could not be read. Try again.")), ...again };
  const shown = "The plan could not be saved. Command and whoever leads the opposing force write it.";
  if (existing.data) {
    const { data, error } = await session.supabase.from("event_opfor").update({ plan }).eq("event_id", id).select("event_id");
    if (error) return { ...(await failed(session, "event.opfor", error, explainRefusal(error, shown))), ...again };
    if (!data || data.length === 0) return { ...(await notYours(session, "event.opfor", shown)), ...again };
  } else {
    const { error } = await session.supabase.from("event_opfor").insert({ event_id: id, plan });
    if (error) return { ...(await failed(session, "event.opfor", error, explainRefusal(error, shown))), ...again };
  }
  refresh();
  return { ok: true, message: "Saved.", stamp: again.stamp };
}

const TASK_LEVELS = ["everyone", "unit", "leaders", "commander"];
const TASK_IS_THE_WRITERS = "The task could not be saved. Whoever writes the event's orders gives each unit its task.";

/** Give a unit its task, or change the one it has: its words, its callsign and who reads it. */
export async function saveUnitTask(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const rowId = formData.get("task");
  const task = uuid(rowId);
  const unit = uuid(formData.get("unit"));
  const level = String(formData.get("level") ?? "");
  if (!id || (rowId !== null && rowId !== "" && !task) || !TASK_LEVELS.includes(level)) return notThisPage(session, "event.task");
  const again = { values: typedInto(formData), stamp: Date.now() };
  if (!task && !unit) return { ok: false, message: "Choose the unit.", ...again };

  const body = typed(formData.get("body"));
  if (body === "") return { ok: false, message: "Write the task.", ...again };
  if (body.length > 2000) return { ok: false, message: "Keep the task under 2,000 characters.", ...again };
  const callsign = typed(formData.get("callsign")).replace(/\s+/g, " ");
  if (callsign.length > 40) return { ok: false, message: "Keep the callsign under 40 characters.", ...again };

  if (task) {
    // Asking for the id back says whether the change matched a task this person may change.
    const { data, error } = await session.supabase
      .from("event_unit_tasks")
      .update({ body, callsign, level })
      .eq("id", task)
      .eq("event_id", id)
      .select("id");
    if (error) return { ...(await failed(session, "event.task", error, explainRefusal(error, TASK_IS_THE_WRITERS))), ...again };
    if (!data || data.length === 0) return { ...(await notYours(session, "event.task", TASK_IS_THE_WRITERS)), ...again };
    refresh();
    return { ok: true, message: "Saved.", stamp: again.stamp };
  }

  const { error } = await session.supabase.from("event_unit_tasks").insert({ event_id: id, unit_id: unit, body, callsign, level });
  if (error) {
    const shown = error.code === "23505" ? "That unit already has a task. Change the one it has." : explainRefusal(error, TASK_IS_THE_WRITERS);
    return { ...(await failed(session, "event.task", error, shown)), ...again };
  }
  refresh();
  return { ok: true, message: "Added.", stamp: again.stamp };
}

/** Take a unit's task away. */
export async function removeUnitTask(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const task = uuid(formData.get("task"));
  if (!id || !task) return notThisPage(session, "event.task");
  const { data, error } = await session.supabase.from("event_unit_tasks").delete().eq("id", task).eq("event_id", id).select("id");
  if (error) return failed(session, "event.task", error, explainRefusal(error, TASK_IS_THE_WRITERS));
  if (!data || data.length === 0) return notYours(session, "event.task", TASK_IS_THE_WRITERS);
  refresh();
  return { ok: true, message: "Removed." };
}

/** As a unit's commander, open its task to the unit's leaders or to the whole unit. */
export async function passTaskDown(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const task = uuid(formData.get("task"));
  const level = String(formData.get("level") ?? "");
  if (!id || !task || !["leaders", "unit"].includes(level)) return notThisPage(session, "event.task-level");
  const shown = "The task could not be passed down. A unit's commander passes its task down inside the unit.";
  const { data, error } = await session.supabase.from("event_unit_tasks").update({ level }).eq("id", task).eq("event_id", id).select("id");
  if (error) return failed(session, "event.task-level", error, explainRefusal(error, shown));
  if (!data || data.length === 0) return notYours(session, "event.task-level", shown);
  refresh();
  return { ok: true, message: level === "unit" ? "Your unit can now read it." : "Your leaders can now read it." };
}

/** Name a member to the opposing force. They come off the event's roll. */
export async function addOpforMember(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.opfor");
  const member = uuid(formData.get("member"));
  if (!member) return { ok: false, message: "Choose who to name." };

  const { error } = await session.supabase
    .from("event_opfor_members")
    .insert({ event_id: id, member_id: member, leads: formData.get("leads") === "on" });
  if (error) {
    const shown = error.code === "23505" ? "They are already on the opposing force." : explainRefusal(error, OPFOR_IS_COMMANDS);
    return failed(session, "event.opfor", error, shown);
  }
  refresh();
  return { ok: true, message: "Named. They are off the event's roll.", stamp: Date.now() };
}

/** Take a member off the opposing force, or say whether they lead it. */
export async function changeOpforMember(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const member = uuid(formData.get("member"));
  const change = formData.get("change");
  if (!id || !member || (change !== "remove" && change !== "lead" && change !== "follow")) return notThisPage(session, "event.opfor");

  const row = session.supabase.from("event_opfor_members");
  const { data, error } =
    change === "remove"
      ? await row.delete().eq("event_id", id).eq("member_id", member).select("member_id")
      : await row.update({ leads: change === "lead" }).eq("event_id", id).eq("member_id", member).select("member_id");
  if (error) return failed(session, "event.opfor", error, explainRefusal(error, OPFOR_IS_COMMANDS));
  if (!data || data.length === 0) return notYours(session, "event.opfor", OPFOR_IS_COMMANDS);
  refresh();
  return { ok: true, message: change === "remove" ? "Taken off. They can reply to the event again." : "Saved." };
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
  const { data, error } = existing.data
    ? await session.supabase.from("attendance").update({ reply }).eq("event_id", id).eq("member_id", session.id).select("place")
    : await session.supabase.from("attendance").insert({ event_id: id, member_id: session.id, reply }).select("place");
  if (error) return failed(session, "event.reply", error, explainRefusal(error, "Your reply could not be saved. Try again."));
  refresh();
  if (reply === "not_attending") return { ok: true, message: "You are down as not attending." };
  // The database gives the places out in the order replies arrive.
  return data?.[0]?.place === "reserve"
    ? { ok: true, message: "Every place is taken, so you are on the reserve list. You move up if a place opens." }
    : { ok: true, message: "You are down as attending." };
}

/**
 * Put someone in a post for the night, or take them out of it. With no member
 * named it is the person asking, taking an empty post that is open to them.
 * The post is one of the order of battle's, or one of the event's own.
 */
export async function setStandIn(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const position = formData.get("position");
  const extra = formData.get("extra");
  const post = uuid(position);
  const own = uuid(extra);
  // A form names one kind of post, or names neither to take someone out of whichever they are in.
  const emptied = (value: FormDataEntryValue | null) => value === null || value === "";
  if (!id || (!emptied(position) && !post) || (!emptied(extra) && !own) || (post && own)) return notThisPage(session, "event.stand-in");
  const named = formData.get("member");
  const member = named === null ? session.id : uuid(named);
  if (!member) return { ok: false, message: "Choose who stands in." };

  const { data, error } = await session.supabase
    .from("attendance")
    .update(post ? { stand_in_position_id: post } : own ? { event_post_id: own } : { stand_in_position_id: null, event_post_id: null })
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
  if (!post && !own) return { ok: true, message: "Taken out of the post." };
  return { ok: true, message: member === session.id ? (own ? "You have that post for the night." : "You are standing in for that post.") : "Placed." };
}

/** For whoever runs the event: move someone up from the reserve list, or onto it. */
export async function setPlace(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const member = uuid(formData.get("member"));
  const place = formData.get("place");
  if (!id || (place !== "in" && place !== "reserve")) return notThisPage(session, "event.place");
  if (!member) return { ok: false, message: "Choose who to move." };

  const { data, error } = await session.supabase
    .from("attendance")
    .update({ place })
    .eq("event_id", id)
    .eq("member_id", member)
    .select("member_id");
  if (error) return failed(session, "event.place", error, explainRefusal(error, "That could not be done. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.place", "Only whoever runs the event moves someone on or off the reserve list.");
  refresh();
  return { ok: true, message: place === "in" ? "Given a place." : "Moved to the reserve list." };
}

const NOT_YOURS_TO_SET = "Only whoever runs the event says who takes part.";

/** Make a set of rows match what a form ticked: add what is new, and take away what was unticked. */
async function matchRows(
  session: Session,
  table: "event_units" | "event_key_posts",
  column: "unit_id" | "position_id",
  id: string,
  wanted: string[],
): Promise<OpsResult> {
  const current = await session.supabase.from(table).select(column).eq("event_id", id);
  if (current.error) return failed(session, "event.taking", current.error, "That could not be read. Try again.");
  const have = new Set(((current.data ?? []) as unknown as Record<string, string>[]).map((row) => row[column]));

  let changed = 0;
  for (const value of have) {
    if (wanted.includes(value)) continue;
    const { data, error } = await session.supabase.from(table).delete().eq("event_id", id).eq(column, value).select(column);
    if (error) return failed(session, "event.taking", error, explainRefusal(error, "That could not be saved. Try again."));
    if (!data || data.length === 0) return notYours(session, "event.taking", NOT_YOURS_TO_SET);
    changed += 1;
  }
  for (const value of wanted) {
    if (have.has(value)) continue;
    const { error } = await session.supabase.from(table).insert({ event_id: id, [column]: value });
    if (error) return failed(session, "event.taking", error, explainRefusal(error, NOT_YOURS_TO_SET));
    changed += 1;
  }
  if (changed > 0) refresh();
  return { ok: true, message: changed > 0 ? "Saved." : "Nothing was changed.", stamp: Date.now() };
}

const ticked = (formData: FormData, name: string) => [
  ...new Set(formData.getAll(name).filter((value): value is string => typeof value === "string" && UUID.test(value))),
];

/** Say which units take part. With none ticked, every open unit does. */
export async function saveUnits(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.taking");
  return matchRows(session, "event_units", "unit_id", id, ticked(formData, "unit"));
}

/** Say which posts must be filled for the event to go ahead. */
export async function saveKeyPosts(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.taking");
  return matchRows(session, "event_key_posts", "position_id", id, ticked(formData, "post"));
}

/** Add posts that exist for this event only. Several of one kind are numbered: Trainee 1, Trainee 2. */
export async function addExtraPosts(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.taking");
  const again = { values: typedInto(formData), stamp: Date.now() };

  const title = typed(formData.get("title")).replace(/\s+/g, " ");
  if (title.length < 2 || title.length > 76) return { ok: false, message: "Give the post a title of 2 to 76 characters.", ...again };
  const role = uuid(formData.get("role"));
  if (!role) return { ok: false, message: "Choose the role the post is.", ...again };
  const many = Number(formData.get("count") ?? 1);
  if (!Number.isInteger(many) || many < 1 || many > 12) return { ok: false, message: "Add from 1 to 12 posts at a time.", ...again };

  const current = await session.supabase.from("event_posts").select("sort_order").eq("event_id", id);
  if (current.error) return { ...(await failed(session, "event.taking", current.error, "The posts could not be read. Try again.")), ...again };
  const last = Math.max(0, ...(current.data ?? []).map((row) => Number(row.sort_order)));

  for (let number = 1; number <= many; number += 1) {
    const { error } = await session.supabase.from("event_posts").insert({
      event_id: id,
      title: many > 1 ? `${title} ${number}` : title,
      role_id: role,
      must_fill: formData.get("must_fill") === "on",
      open_to_volunteers: formData.get("open_to_volunteers") === "on",
      sort_order: last + number,
    });
    if (error) {
      const shown = error.code === "23505" ? "The event already has a post with that title." : explainRefusal(error, NOT_YOURS_TO_SET);
      refresh();
      return { ...(await failed(session, "event.taking", error, shown)), ...again };
    }
  }
  refresh();
  return { ok: true, message: many > 1 ? `${many} posts added.` : "Added.", stamp: again.stamp };
}

/** Take one of the event's own posts away. Whoever was in it is left with no post for the night. */
export async function removeExtraPost(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const post = uuid(formData.get("post"));
  if (!id || !post) return notThisPage(session, "event.taking");
  const { data, error } = await session.supabase.from("event_posts").delete().eq("id", post).eq("event_id", id).select("id");
  if (error) return failed(session, "event.taking", error, explainRefusal(error, "The post could not be removed. Try again."));
  if (!data || data.length === 0) return notYours(session, "event.taking", NOT_YOURS_TO_SET);
  refresh();
  return { ok: true, message: "Removed." };
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
  const closed = await session.supabase.from("events").update({ state: "done" }).eq("id", id).eq("state", "announced").select("id");
  if (closed.error) {
    const shown = explainRefusal(closed.error, "The return was saved, but the event could not be closed.");
    return failed(session, "event.return", closed.error, shown);
  }
  refresh();
  // Only the return that closed the event can have left a draft for next week.
  const justClosed = (closed.data ?? []).length > 0;
  return { ok: true, message: "The attendance return is made.", link: justClosed ? await nextWeeks(session, id) : undefined };
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

const NOT_YOURS_TO_PLAN = "Only whoever runs the event writes its plan.";
const NOT_YOURS_TO_REPORT = "Only whoever ran the event writes its report.";

/** What a list belongs to: the plan, or the after-action report. Each has its own name in the log and its own words. */
const listOf = (part: PlanPart): { attempt: Attempt; notYours: string } =>
  part.report ? { attempt: "event.report", notYours: NOT_YOURS_TO_REPORT } : { attempt: "event.plan", notYours: NOT_YOURS_TO_PLAN };

/**
 * Add a record to one of an event's lists, or change one: an objective, an
 * element and its task, a timing, a ship, a net, a loss or a mention. The
 * list's fields come from `planParts`, so this never names a column of its own.
 */
export async function savePlanRow(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const part = planPartOf(String(formData.get("part") ?? ""));
  const id = uuid(formData.get("id"));
  const rowId = formData.get("row");
  const row = uuid(rowId);
  if (!part || !id || (rowId !== null && rowId !== "" && !row)) return notThisPage(session, part?.report ? "event.report" : "event.plan");
  const { attempt, notYours: notMine } = listOf(part);
  const again = { values: typedInto(formData), stamp: Date.now() };

  const record: Record<string, string | number> = {};
  for (const field of part.fields) {
    const text = typed(formData.get(field.key));
    if (field.kind === "member") {
      // Who a record is about is set when it is added, and not changed afterwards.
      if (row) continue;
      const member = uuid(text);
      if (!member) return { ok: false, message: `Choose "${field.label}".`, ...again };
      record[field.key] = member;
      continue;
    }
    if (field.kind === "number") {
      const value = Number(text);
      if (text === "" || !Number.isInteger(value) || value < 1 || value > field.max) {
        return { ok: false, message: `"${field.label}" is a whole number from 1 to ${field.max}.`, ...again };
      }
      record[field.key] = value;
      continue;
    }
    const value = field.kind === "long" ? text : text.replace(/\s+/g, " ");
    if (value === "" && field.required) return { ok: false, message: `Fill in "${field.label}".`, ...again };
    if (value.length > field.max) return { ok: false, message: `Keep "${field.label}" under ${field.max.toLocaleString("en-GB")} characters.`, ...again };
    if (field.kind !== "time") {
      record[field.key] = value;
      continue;
    }
    // A time of day is kept as minutes before or after the event's start.
    const event = await session.supabase.from("events").select("starts_at").eq("id", id).maybeSingle();
    if (event.error) return { ...(await failed(session, attempt, event.error, "The event could not be read. Try again.")), ...again };
    const offset = event.data ? minutesFromStart(event.data.starts_at as string, value) : null;
    if (offset === null) return { ok: false, message: "Give the time as hours and minutes, in UTC.", ...again };
    record.offset_minutes = offset;
  }

  if (row) {
    const { data, error } = await session.supabase.from(part.table).update(record).eq("id", row).eq("event_id", id).select("id");
    if (error) return { ...(await failed(session, attempt, error, explainList(part, error, notMine))), ...again };
    if (!data || data.length === 0) return { ...(await notYours(session, attempt, notMine)), ...again };
    refresh();
    return { ok: true, message: "Saved.", stamp: again.stamp };
  }

  if (part.ordered) {
    const current = await session.supabase.from(part.table).select("sort_order").eq("event_id", id);
    if (current.error) return { ...(await failed(session, attempt, current.error, "The list could not be read. Try again.")), ...again };
    record.sort_order = Math.max(0, ...(current.data ?? []).map((entry) => Number(entry.sort_order))) + 1;
  }
  const { error } = await session.supabase.from(part.table).insert({ event_id: id, ...record });
  if (error) return { ...(await failed(session, attempt, error, explainList(part, error, notMine))), ...again };
  refresh();
  return { ok: true, message: "Added.", stamp: again.stamp };
}

function explainList(part: PlanPart, error: { code?: string; message: string }, otherwise: string): string {
  if (error.code === "23505") {
    return part.key === "mentions"
      ? "That member is already mentioned for this event. Change the mention they have."
      : `The event already has ${/^[aeiou]/.test(part.one) ? "an" : "a"} ${part.one} with that name.`;
  }
  return explainRefusal(error, otherwise);
}

/** Take a record out of one of an event's lists. */
export async function removePlanRow(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const part = planPartOf(String(formData.get("part") ?? ""));
  const id = uuid(formData.get("id"));
  const row = uuid(formData.get("row"));
  if (!part || !id || !row) return notThisPage(session, part?.report ? "event.report" : "event.plan");
  const { attempt, notYours: notMine } = listOf(part);
  const { data, error } = await session.supabase.from(part.table).delete().eq("id", row).eq("event_id", id).select("id");
  if (error) return failed(session, attempt, error, explainRefusal(error, "That could not be removed. Try again."));
  if (!data || data.length === 0) return notYours(session, attempt, notMine);
  refresh();
  return { ok: true, message: "Removed." };
}

/** Say which sections of the manual to read before the night, one to a line as volume/section. */
export async function saveReading(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.plan");
  const again = { values: typedInto(formData), stamp: Date.now() };

  const lines = [
    ...new Set(
      typed(formData.get("reading"))
        .split("\n")
        // An address pasted from the site is tidied: /manual/command/orders is command/orders.
        .map((line) => line.trim().replace(/^\/?(manual\/)?/, ""))
        .filter(Boolean),
    ),
  ];
  if (lines.length > 12) return { ok: false, message: "Keep the reading to 12 sections.", ...again };
  const odd = lines.find((line) => !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(line));
  if (odd) return { ok: false, message: `"${odd}" is not a section of the manual. Write each as volume/section, such as command/orders.`, ...again };

  const { data, error } = await session.supabase.from("events").update({ reading: lines }).eq("id", id).select("id");
  if (error) return { ...(await failed(session, "event.plan", error, explainRefusal(error, "The reading could not be saved. Try again."))), ...again };
  if (!data || data.length === 0) return { ...(await notYours(session, "event.plan", NOT_YOURS_TO_PLAN)), ...again };
  refresh();
  return { ok: true, message: "Saved.", stamp: again.stamp };
}

/**
 * Issue an amendment: a change to the orders after the event was announced.
 * The database numbers it, dates it and signs it, and everyone attending is
 * asked to acknowledge it.
 */
export async function issueAmendment(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.amend");
  const again = { values: typedInto(formData), stamp: Date.now() };
  const body = typed(formData.get("body"));
  if (body === "") return { ok: false, message: "Say what has changed.", ...again };
  if (body.length > 2000) return { ok: false, message: "Keep the amendment under 2,000 characters.", ...again };

  const { data, error } = await session.supabase.from("event_amendments").insert({ event_id: id, body }).select("number").single();
  if (error) {
    const shown = explainRefusal(error, "The amendment could not be issued. Only whoever runs the event issues one.");
    return { ...(await failed(session, "event.amend", error, shown)), ...again };
  }
  refresh();
  return { ok: true, message: `Amendment ${data?.number ?? ""} is issued. Everyone attending is asked to acknowledge it.`.replace("  ", " "), stamp: again.stamp };
}

/** Acknowledge the latest amendment. The database records which one, and when. */
export async function acknowledgeAmendment(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const number = Number(formData.get("number"));
  if (!id || !Number.isInteger(number) || number < 1) return notThisPage(session, "event.acknowledge");

  const existing = await session.supabase
    .from("event_acknowledgements")
    .select("member_id")
    .eq("event_id", id)
    .eq("member_id", session.id)
    .maybeSingle();
  if (existing.error) return failed(session, "event.acknowledge", existing.error, "That could not be saved. Try again.");
  const { error } = existing.data
    ? await session.supabase.from("event_acknowledgements").update({ amendment_number: number }).eq("event_id", id).eq("member_id", session.id)
    : await session.supabase.from("event_acknowledgements").insert({ event_id: id, member_id: session.id, amendment_number: number });
  if (error) return failed(session, "event.acknowledge", error, explainRefusal(error, "That could not be saved. Try again."));
  refresh();
  return { ok: true, message: "Acknowledged." };
}

/**
 * Sign off who passed at an event that teaches a qualification. Each pass is
 * an award in the instructor's own name, pointing back at the event. The
 * database decides who may award, and that the member was there.
 */
export async function signOff(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.sign-off");
  const passed = ticked(formData, "pass");
  if (passed.length === 0) return { ok: false, message: "Tick who passed first." };

  const event = await session.supabase.from("events").select("teaches_qualification_id").eq("id", id).maybeSingle();
  if (event.error) return failed(session, "event.sign-off", event.error, "The event could not be read. Try again.");
  const qualification = event.data?.teaches_qualification_id as string | null | undefined;
  if (!qualification) return notThisPage(session, "event.sign-off");

  let signed = 0;
  for (const member of passed) {
    const { error } = await session.supabase
      .from("qualification_awards")
      .insert({ member_id: member, qualification_id: qualification, awarded_by: session.id, event_id: id });
    // Someone who already holds it has nothing to be signed off for.
    if (error?.code === "23505") continue;
    if (error) {
      if (signed > 0) refresh();
      const shown = explainRefusal(error, "That could not be signed off. Only an instructor signs off a qualification, and never their own.");
      return failed(session, "event.sign-off", error, shown);
    }
    signed += 1;
  }
  refresh();
  return {
    ok: true,
    message: signed === 0 ? "They already hold it." : signed === 1 ? "1 pass signed off." : `${signed} passes signed off.`,
    stamp: Date.now(),
  };
}

/** Say how each objective turned out. One left unanswered has its answer taken away. */
export async function saveOutcomes(_previous: OpsResult, formData: FormData): Promise<OpsResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "event.report");

  const wanted: { objective: string; outcome: string; note: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("outcome:")) continue;
    const objective = uuid(key.slice("outcome:".length));
    if (!objective || typeof value !== "string" || (value !== "" && !(value in outcomeNames))) return notThisPage(session, "event.report");
    const note = typed(formData.get(`note:${objective}`)).replace(/\s+/g, " ");
    if (note.length > 300) return { ok: false, message: "Keep each note under 300 characters." };
    wanted.push({ objective, outcome: value, note });
  }

  const current = await session.supabase.from("event_objective_outcomes").select("objective_id, outcome, note").eq("event_id", id);
  if (current.error) return failed(session, "event.report", current.error, "The outcomes could not be read. Try again.");
  const have = new Map((current.data ?? []).map((row) => [row.objective_id as string, row]));

  let changed = 0;
  for (const entry of wanted) {
    const held = have.get(entry.objective);
    if (entry.outcome === "") {
      if (!held) continue;
      const { data, error } = await session.supabase.from("event_objective_outcomes").delete().eq("objective_id", entry.objective).select("objective_id");
      if (error) return failed(session, "event.report", error, explainRefusal(error, NOT_YOURS_TO_REPORT));
      if (!data || data.length === 0) return notYours(session, "event.report", NOT_YOURS_TO_REPORT);
    } else if (!held) {
      const { error } = await session.supabase
        .from("event_objective_outcomes")
        .insert({ objective_id: entry.objective, event_id: id, outcome: entry.outcome, note: entry.note });
      if (error) return failed(session, "event.report", error, explainRefusal(error, NOT_YOURS_TO_REPORT));
    } else if (held.outcome !== entry.outcome || held.note !== entry.note) {
      const { data, error } = await session.supabase
        .from("event_objective_outcomes")
        .update({ outcome: entry.outcome, note: entry.note })
        .eq("objective_id", entry.objective)
        .select("objective_id");
      if (error) return failed(session, "event.report", error, explainRefusal(error, NOT_YOURS_TO_REPORT));
      if (!data || data.length === 0) return notYours(session, "event.report", NOT_YOURS_TO_REPORT);
    } else {
      continue;
    }
    changed += 1;
  }
  if (changed > 0) refresh();
  return { ok: true, message: changed > 0 ? "Saved." : "Nothing was changed.", stamp: Date.now() };
}
