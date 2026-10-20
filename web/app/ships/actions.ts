"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { explainRefusal } from "@/lib/refusals";
import { HIDDEN, readCrew, TEMPLATE_SOURCE_LIMIT } from "@/lib/crew-form";
import { readShip } from "@/lib/ships-form";
import { createClient } from "@/lib/supabase/server";

/**
 * What a member does with their ships, what command does with any, and what
 * command does with the crew templates. Nothing here decides who may: the
 * database does.
 */

export type ShipResult = { ok: boolean; message: string; values?: Record<string, string>; stamp?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED: ShipResult = { ok: false, message: "This site is not connected to the database yet." };
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
const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const notThisPage = async (session: Session, action: Attempt): Promise<ShipResult> => ({ ok: false, message: await refused(session.supabase, action, NOT_THIS_PAGE) });
function typedInto(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  return values;
}

/** Register a ship: the member's own, or, for command, anyone's or the fleet's. */
export async function registerShip(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const again = { values: typedInto(formData) };
  const read = readShip((name) => (name === "note" ? (typeof formData.get(name) === "string" ? (formData.get(name) as string).trim() : "") : text(formData.get(name))));
  if ("problem" in read) return { ok: false, message: read.problem, ...again };
  const owner = formData.get("owner");
  const ownerId = owner === null || owner === "" ? null : uuid(owner);
  if (owner !== null && owner !== "" && owner !== "fleet" && !ownerId) return notThisPage(session, "ship.register");
  const record: Record<string, unknown> = { model_id: read.fields.model_id, name: read.fields.name, ready: read.fields.ready };
  // A member's own ship needs no owner named. Command names one, or the fleet.
  if (owner !== null && owner !== "") record.owner_id = ownerId;
  const made = await session.supabase.from("ships").insert(record).select("id").single();
  if (made.error) return { ok: false, message: await turnedDown(session.supabase, "ship.register", made.error, explainRefusal(made.error, "The ship could not be registered.")), ...again };
  if (read.fields.note) {
    const noted = await session.supabase.from("ship_notes").insert({ ship_id: made.data.id as string, note: read.fields.note });
    if (noted.error) {
      refresh();
      return { ok: false, message: await turnedDown(session.supabase, "ship.register", noted.error, "The ship is registered, but the note could not be saved."), stamp: Date.now() };
    }
  }
  refresh();
  return { ok: true, message: "Registered.", stamp: Date.now() };
}

/** Change a ship's name, its mark, its note, and for command its model or owner. */
export async function saveShip(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "ship.save");
  const again = { values: typedInto(formData) };
  const read = readShip((name) => (name === "note" ? (typeof formData.get(name) === "string" ? (formData.get(name) as string).trim() : "") : text(formData.get(name))));
  if ("problem" in read) return { ok: false, message: read.problem, ...again };
  const record: Record<string, unknown> = { name: read.fields.name, ready: read.fields.ready, model_id: read.fields.model_id };
  const owner = formData.get("owner");
  if (owner !== null) record.owner_id = owner === "" || owner === "fleet" ? null : uuid(owner);
  const saved = await session.supabase.from("ships").update(record).eq("id", id).select("id");
  if (saved.error) return { ok: false, message: await turnedDown(session.supabase, "ship.save", saved.error, explainRefusal(saved.error, "The ship could not be saved. Only the owner or command changes a ship.")), ...again };
  if (!saved.data || saved.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.save", "The ship could not be saved. Only the owner or command changes a ship."), ...again };
  // The note is written, replaced or removed with the rest.
  const noted = read.fields.note ? await writeNote(session, id, read.fields.note) : await session.supabase.from("ship_notes").delete().eq("ship_id", id);
  refresh();
  if (noted.error) return { ok: false, message: await turnedDown(session.supabase, "ship.save", noted.error, "The ship is saved, but its note could not be."), stamp: Date.now() };
  return { ok: true, message: "Saved.", stamp: Date.now() };
}

/** Write a ship's note: a new one, or in place of the old. */
async function writeNote(session: Session, shipId: string, note: string) {
  const changed = await session.supabase.from("ship_notes").update({ note }).eq("ship_id", shipId).select("ship_id");
  if (changed.error || (changed.data && changed.data.length > 0)) return changed;
  return session.supabase.from("ship_notes").insert({ ship_id: shipId, note }).select("ship_id");
}

const MARKS = {
  ready: { ready: true, in_claim: false },
  down: { ready: false, in_claim: false },
  claim: { ready: false, in_claim: true },
} as const;
const WITHDRAWN = "It is withdrawn from events whose roll is still open; where the roll has closed, whoever runs the event is shown it is down.";

/** Mark a ship ready, not ready or in claim, from its line. */
export async function markShip(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  const mark = formData.get("mark");
  if (!id || typeof mark !== "string" || !(mark in MARKS)) return notThisPage(session, "ship.save");
  const saved = await session.supabase.from("ships").update(MARKS[mark as keyof typeof MARKS]).eq("id", id).select("id");
  if (saved.error) return { ok: false, message: await turnedDown(session.supabase, "ship.save", saved.error, explainRefusal(saved.error, "The mark could not be saved.")) };
  if (!saved.data || saved.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.save", "Only the owner or command marks a ship.") };
  refresh();
  return {
    ok: true,
    message: mark === "ready" ? "Marked ready." : mark === "down" ? `Marked not ready. ${WITHDRAWN}` : `Marked in claim. ${WITHDRAWN}`,
    stamp: Date.now(),
  };
}

/** Command: the roles a model fills, and which is the primary. At least one. */
export async function saveModelRoles(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const model = uuid(formData.get("model"));
  if (!model) return notThisPage(session, "ship.roles");
  const wanted = new Set<string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("role_") && value === "on") {
      const id = uuid(key.slice("role_".length));
      if (!id) return notThisPage(session, "ship.roles");
      wanted.add(id);
    }
  }
  if (wanted.size === 0) return { ok: false, message: "A model fills at least one role. Tick the ones it fills." };
  const primary = uuid(formData.get("primary"));
  if (!primary || !wanted.has(primary)) return { ok: false, message: "Choose the primary role from the ones ticked." };
  const held = await session.supabase.from("ship_model_roles").select("role_id, is_primary").eq("model_id", model);
  if (held.error) return { ok: false, message: await turnedDown(session.supabase, "ship.roles", held.error, "The model's roles could not be read.") };
  const have = new Map((held.data ?? []).map((row) => [row.role_id as string, row.is_primary === true]));
  // The primary first, so that the rest are never without one; then the others; then what is no longer wanted.
  // Each step asks for the row back: a change the database quietly matched to nothing is a refusal too.
  const steps: (() => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>)[] = [];
  if (!have.has(primary)) steps.push(() => session.supabase.from("ship_model_roles").insert({ model_id: model, role_id: primary, is_primary: true }).select("role_id"));
  else if (!have.get(primary)) steps.push(() => session.supabase.from("ship_model_roles").update({ is_primary: true }).eq("model_id", model).eq("role_id", primary).select("role_id"));
  for (const id of wanted) if (id !== primary && !have.has(id)) steps.push(() => session.supabase.from("ship_model_roles").insert({ model_id: model, role_id: id, is_primary: false }).select("role_id"));
  for (const id of have.keys()) if (!wanted.has(id)) steps.push(() => session.supabase.from("ship_model_roles").delete().eq("model_id", model).eq("role_id", id).select("role_id"));
  const notSaved = "The roles could not be saved. Command keeps them.";
  for (const step of steps) {
    const { data, error } = await step();
    if (error) {
      refresh();
      return { ok: false, message: await turnedDown(session.supabase, "ship.roles", error, explainRefusal(error, notSaved)), stamp: Date.now() };
    }
    if (!Array.isArray(data) || data.length === 0) {
      refresh();
      return { ok: false, message: await refused(session.supabase, "ship.roles", notSaved), stamp: Date.now() };
    }
  }
  // Nothing to do is still a save. Either way, what the model holds now is what was asked for.
  const now = await session.supabase.from("ship_model_roles").select("role_id, is_primary").eq("model_id", model);
  const holds = new Map((now.data ?? []).map((row) => [row.role_id as string, row.is_primary === true]));
  if (!now.error && (holds.size !== wanted.size || [...wanted].some((id) => !holds.has(id)) || holds.get(primary) !== true)) {
    refresh();
    return { ok: false, message: await refused(session.supabase, "ship.roles", notSaved), stamp: Date.now() };
  }
  refresh();
  return { ok: true, message: "Saved.", stamp: Date.now() };
}

/** Take a ship off the register. */
export async function removeShip(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const id = uuid(formData.get("id"));
  if (!id) return notThisPage(session, "ship.remove");
  const gone = await session.supabase.from("ships").delete().eq("id", id).select("id");
  if (gone.error) return { ok: false, message: await turnedDown(session.supabase, "ship.remove", gone.error, explainRefusal(gone.error, "The ship could not be removed.")) };
  if (!gone.data || gone.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.remove", "Only the owner or command removes a ship.") };
  refresh();
  return { ok: true, message: "Removed from the register.", stamp: Date.now() };
}

/** Offer a ship for an event, or withdraw it. */
export async function offerShip(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const event = uuid(formData.get("event"));
  const ship = uuid(formData.get("ship"));
  // The button names the ship; a field beside it says which way it goes.
  const change = ship ? formData.get(`change_${ship}`) : null;
  if (!event || !ship || (change !== "offer" && change !== "withdraw")) return notThisPage(session, "ship.offer");
  if (change === "offer") {
    const { error } = await session.supabase.from("event_ship_offers").insert({ event_id: event, ship_id: ship });
    if (error?.code === "23505") return { ok: true, message: "Already offered.", stamp: Date.now() };
    if (error) return { ok: false, message: await turnedDown(session.supabase, "ship.offer", error, explainRefusal(error, "The ship could not be offered.")) };
    refresh();
    return { ok: true, message: "Offered.", stamp: Date.now() };
  }
  const gone = await session.supabase.from("event_ship_offers").delete().eq("event_id", event).eq("ship_id", ship).select("ship_id");
  if (gone.error) return { ok: false, message: await turnedDown(session.supabase, "ship.offer", gone.error, explainRefusal(gone.error, "The offer could not be withdrawn.")) };
  if (!gone.data || gone.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.offer", "Only whoever offered a ship withdraws it, until the roll closes.") };
  refresh();
  return { ok: true, message: "Withdrawn.", stamp: Date.now() };
}

/** Command: add a crew template to a model, or rename one, or make it the standard. */
export async function saveTemplate(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const model = uuid(formData.get("model"));
  const template = uuid(formData.get("template"));
  const name = text(formData.get("name"));
  const source = text(formData.get("source"));
  const makeDefault = formData.get("default") === "on";
  if (!model) return notThisPage(session, "ship.templates");
  if (name.length === 0 || name.length > 60) return { ok: false, message: "Give the template a name of up to 60 characters." };
  if (source.length > TEMPLATE_SOURCE_LIMIT) return { ok: false, message: `Keep where it comes from under ${TEMPLATE_SOURCE_LIMIT} characters.` };
  if (HIDDEN.test(source)) return { ok: false, message: "Where it comes from has a hidden character in it. Type it again." };
  // The name first, so that a name already taken changes nothing else.
  const saved = template
    ? await session.supabase.from("crew_templates").update({ name, source }).eq("id", template).eq("model_id", model).select("id")
    : await session.supabase.from("crew_templates").insert({ model_id: model, name, source }).select("id");
  if (saved.error) {
    const shown = saved.error.code === "23505" ? "This model already has a template of that name." : explainRefusal(saved.error, "That could not be saved. Command keeps the crew templates.");
    return { ok: false, message: await turnedDown(session.supabase, "ship.templates", saved.error, shown) };
  }
  if (!saved.data || saved.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.templates", "That could not be saved. Command keeps the crew templates.") };
  if (makeDefault) {
    // One standard for a model: the old one steps down, then this one steps up.
    const id = saved.data[0].id as string;
    const stepped = await session.supabase.from("crew_templates").update({ is_default: false }).eq("model_id", model).eq("is_default", true).neq("id", id).select("id");
    const raised = stepped.error ? stepped : await session.supabase.from("crew_templates").update({ is_default: true }).eq("id", id).select("id");
    if (raised.error) {
      refresh();
      return { ok: false, message: await turnedDown(session.supabase, "ship.templates", raised.error, explainRefusal(raised.error, "The template is saved, but could not be made the standard.")), stamp: Date.now() };
    }
  }
  refresh();
  return { ok: true, message: template ? "Saved." : "Template added.", stamp: Date.now() };
}

/** Command: remove a template that is not the standard. */
export async function deleteTemplate(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const template = uuid(formData.get("template"));
  if (!template) return notThisPage(session, "ship.templates");
  const gone = await session.supabase.from("crew_templates").delete().eq("id", template).eq("is_default", false).select("id");
  if (gone.error) return { ok: false, message: await turnedDown(session.supabase, "ship.templates", gone.error, explainRefusal(gone.error, "That could not be removed.")) };
  if (!gone.data || gone.data.length === 0) return { ok: false, message: await refused(session.supabase, "ship.templates", "The standard template stays. Make another the standard first.") };
  refresh();
  return { ok: true, message: "Template removed.", stamp: Date.now() };
}

/**
 * Command: the whole crew of a template, as the editor sends it. The server
 * works out what changed and writes only that: departments and stations
 * removed, then changed, then added, then the stand-ins that point at new
 * stations. Two stations trading names, or two departments, are given a
 * passing name first so that the database's uniqueness rule is never tripped
 * on the way. Each step asks the database for the row back, so a quiet
 * refusal is a refusal. The steps are separate requests, so a failure midway
 * leaves the crew part-saved; the page then shows what the database holds.
 */
export async function saveCrew(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const template = uuid(formData.get("template"));
  const raw = formData.get("crew");
  if (!template || typeof raw !== "string") return notThisPage(session, "ship.templates");
  const read = readCrew(raw);
  if ("problem" in read) return { ok: false, message: read.problem };
  const { crew } = read;
  const db = session.supabase;
  const notSaved = "The crew could not be saved. Command keeps the crew templates.";
  const partWay = "Part of the crew may have been saved; the page shows what the database holds.";
  const fail = async (error: { message: string; code?: string } | null, begun: boolean) => {
    refresh();
    const shown = error?.code === "23505" ? "Two stations of one role, or two departments, share a name. Give each its own." : error ? explainRefusal(error, notSaved) : notSaved;
    const message = error ? await turnedDown(db, "ship.templates", error, shown) : await refused(db, "ship.templates", notSaved);
    return { ok: false, message: begun ? `${message} ${partWay}` : message, stamp: Date.now() };
  };
  const ok = (result: { data: unknown; error: { message: string; code?: string } | null }) => !result.error && Array.isArray(result.data) && result.data.length > 0;

  const [haveGroups, haveStations] = await Promise.all([
    db.from("crew_template_groups").select("id, name, sort_order").eq("template_id", template),
    db.from("crew_template_stations").select("id, role_id, name, count, minimum, group_id, brief, stand_in_id, sort_order").eq("template_id", template),
  ]);
  if (haveGroups.error) return fail(haveGroups.error, false);
  if (haveStations.error) return fail(haveStations.error, false);
  type GroupRow = { id: string; name: string; sort_order: number };
  type StationRow = { id: string; role_id: string; name: string; count: number; minimum: number; group_id: string | null; brief: string; stand_in_id: string | null; sort_order: number };
  const groupNow = new Map(((haveGroups.data ?? []) as GroupRow[]).map((row) => [row.id, row]));
  const stationNow = new Map(((haveStations.data ?? []) as StationRow[]).map((row) => [row.id, row]));
  // An id the editor sends that is not this template's is treated as new, so nothing of another template is touched.
  const groups = crew.groups.map((group) => ({ ...group, id: group.id && groupNow.has(group.id) ? group.id : null }));
  const stations = crew.stations.map((station) => ({ ...station, id: station.id && stationNow.has(station.id) ? station.id : null }));
  let begun = false;

  // Removals first, so that a name freed can be used again below.
  for (const id of stationNow.keys()) {
    if (stations.some((station) => station.id === id)) continue;
    begun = true;
    const gone = await db.from("crew_template_stations").delete().eq("id", id).select("id");
    if (!ok(gone)) return fail(gone.error, begun);
    stationNow.delete(id);
  }
  for (const id of groupNow.keys()) {
    if (groups.some((group) => group.id === id)) continue;
    begun = true;
    const gone = await db.from("crew_template_groups").delete().eq("id", id).select("id");
    if (!ok(gone)) return fail(gone.error, begun);
    groupNow.delete(id);
  }

  // A passing name for a department or station whose new name is one another still holds.
  const passing = (id: string) => `~${id.slice(0, 8)}`;
  const groupNamesNow = new Map([...groupNow.values()].map((row) => [row.name.toLowerCase(), row.id]));
  for (const group of groups) {
    if (!group.id) continue;
    const holder = groupNamesNow.get(group.name.toLowerCase());
    if (holder && holder !== group.id) {
      begun = true;
      const moved = await db.from("crew_template_groups").update({ name: passing(holder) }).eq("id", holder).select("id");
      if (!ok(moved)) return fail(moved.error, begun);
      groupNow.get(holder)!.name = passing(holder);
    }
  }
  const stationKeysNow = new Map([...stationNow.values()].map((row) => [`${row.role_id}:${row.name.toLowerCase()}`, row.id]));
  for (const station of stations) {
    const holder = stationKeysNow.get(`${station.roleId}:${station.name.toLowerCase()}`);
    if (holder && holder !== station.id) {
      begun = true;
      const moved = await db.from("crew_template_stations").update({ name: passing(holder) }).eq("id", holder).select("id");
      if (!ok(moved)) return fail(moved.error, begun);
      stationNow.get(holder)!.name = passing(holder);
    }
  }

  // Departments: changed, then added, so that stations can point at them.
  const groupIdOf = new Map<string, string>();
  for (const group of groups) {
    if (group.id) {
      const now = groupNow.get(group.id)!;
      if (now.name !== group.name || now.sort_order !== group.sortOrder) {
        begun = true;
        const saved = await db.from("crew_template_groups").update({ name: group.name, sort_order: group.sortOrder }).eq("id", group.id).select("id");
        if (!ok(saved)) return fail(saved.error, begun);
      }
      groupIdOf.set(group.key, group.id);
    }
  }
  for (const group of groups) {
    if (group.id) continue;
    begun = true;
    const saved = await db.from("crew_template_groups").insert({ template_id: template, name: group.name, sort_order: group.sortOrder }).select("id");
    if (!ok(saved)) return fail(saved.error, begun);
    groupIdOf.set(group.key, (saved.data as { id: string }[])[0].id);
  }

  // Stations: changed, then added. A stand-in that already has an id is set here; one pointing at a new station waits.
  const stationIdOf = new Map<string, string>();
  for (const station of stations) if (station.id) stationIdOf.set(station.key, station.id);
  const fieldsOf = (station: (typeof stations)[number]) => ({
    role_id: station.roleId,
    name: station.name,
    count: station.count,
    minimum: station.minimum,
    group_id: station.groupKey ? (groupIdOf.get(station.groupKey) ?? null) : null,
    brief: station.brief,
    sort_order: station.sortOrder,
  });
  const standInOf = (station: (typeof stations)[number]) => (station.standInKey ? (stationIdOf.get(station.standInKey) ?? null) : null);
  for (const station of stations) {
    if (!station.id) continue;
    const now = stationNow.get(station.id)!;
    const fields = fieldsOf(station);
    const standIn = standInOf(station);
    const changed =
      now.role_id !== fields.role_id ||
      now.name !== fields.name ||
      now.count !== fields.count ||
      now.minimum !== fields.minimum ||
      now.group_id !== fields.group_id ||
      now.brief !== fields.brief ||
      now.sort_order !== fields.sort_order ||
      now.stand_in_id !== standIn;
    if (!changed) continue;
    begun = true;
    const saved = await db.from("crew_template_stations").update({ ...fields, stand_in_id: standIn }).eq("id", station.id).select("id");
    if (!ok(saved)) return fail(saved.error, begun);
  }
  for (const station of stations) {
    if (station.id) continue;
    begun = true;
    const saved = await db.from("crew_template_stations").insert({ template_id: template, ...fieldsOf(station), stand_in_id: standInOf(station) }).select("id");
    if (!ok(saved)) return fail(saved.error, begun);
    stationIdOf.set(station.key, (saved.data as { id: string }[])[0].id);
  }
  // Stand-ins that point at a station added above, now that it has an id. The rest were set with their stations.
  for (const station of stations) {
    if (!station.standInKey) continue;
    const target = stations.find((other) => other.key === station.standInKey);
    if (!target || target.id) continue;
    begun = true;
    const saved = await db.from("crew_template_stations").update({ stand_in_id: stationIdOf.get(target.key) ?? null }).eq("id", stationIdOf.get(station.key)!).select("id");
    if (!ok(saved)) return fail(saved.error, begun);
  }
  refresh();
  return { ok: true, message: "Saved.", stamp: Date.now() };
}

/** Command: a new variant for a model, copied from any template: its departments, stations and stand-ins. */
export async function copyTemplate(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const model = uuid(formData.get("model"));
  const from = uuid(formData.get("from"));
  const name = text(formData.get("name"));
  if (!model || !from) return notThisPage(session, "ship.templates");
  if (name.length === 0 || name.length > 60) return { ok: false, message: "Give the new template a name of up to 60 characters." };
  const db = session.supabase;
  const notCopied = "The template could not be copied. Command keeps the crew templates.";
  const [source, groups, stations] = await Promise.all([
    db.from("crew_templates").select("id, name, model_id").eq("id", from),
    db.from("crew_template_groups").select("id, name, sort_order").eq("template_id", from),
    db.from("crew_template_stations").select("id, role_id, name, count, minimum, group_id, brief, stand_in_id, sort_order").eq("template_id", from),
  ]);
  if (source.error || groups.error || stations.error) return { ok: false, message: await turnedDown(db, "ship.templates", (source.error ?? groups.error ?? stations.error)!, notCopied) };
  if (!source.data || source.data.length === 0) return notThisPage(session, "ship.templates");
  const sourceModel = await db.from("ship_models").select("name").eq("id", source.data[0].model_id as string);
  const fromWords = `Copied from the ${sourceModel.data?.[0]?.name ?? "model"}'s ${source.data[0].name as string} template`;
  const made = await db.from("crew_templates").insert({ model_id: model, name, source: fromWords }).select("id");
  if (made.error) {
    const shown = made.error.code === "23505" ? "This model already has a template of that name." : explainRefusal(made.error, notCopied);
    return { ok: false, message: await turnedDown(db, "ship.templates", made.error, shown) };
  }
  if (!made.data || made.data.length === 0) return { ok: false, message: await refused(db, "ship.templates", notCopied) };
  const to = made.data[0].id as string;
  const undo = async (error: { message: string; code?: string } | null) => {
    const removed = await db.from("crew_templates").delete().eq("id", to).select("id");
    refresh();
    const message = error ? await turnedDown(db, "ship.templates", error, explainRefusal(error, notCopied)) : await refused(db, "ship.templates", notCopied);
    const left = removed.error || !removed.data || removed.data.length === 0 ? ` A part-made template called ${name} was left behind; remove it.` : "";
    return { ok: false, message: `${message}${left}`, stamp: Date.now() };
  };
  const groupIdOf = new Map<string, string>();
  for (const group of groups.data ?? []) {
    const saved = await db.from("crew_template_groups").insert({ template_id: to, name: group.name as string, sort_order: group.sort_order as number }).select("id");
    if (saved.error || !saved.data || saved.data.length === 0) return undo(saved.error);
    groupIdOf.set(group.id as string, saved.data[0].id as string);
  }
  const stationIdOf = new Map<string, string>();
  for (const station of stations.data ?? []) {
    const saved = await db
      .from("crew_template_stations")
      .insert({
        template_id: to,
        role_id: station.role_id as string,
        name: station.name as string,
        count: station.count as number,
        minimum: station.minimum as number,
        group_id: station.group_id ? (groupIdOf.get(station.group_id as string) ?? null) : null,
        brief: station.brief as string,
        sort_order: station.sort_order as number,
      })
      .select("id");
    if (saved.error || !saved.data || saved.data.length === 0) return undo(saved.error);
    stationIdOf.set(station.id as string, saved.data[0].id as string);
  }
  for (const station of stations.data ?? []) {
    if (!station.stand_in_id) continue;
    const standIn = stationIdOf.get(station.stand_in_id as string);
    if (!standIn) continue;
    const saved = await db.from("crew_template_stations").update({ stand_in_id: standIn }).eq("id", stationIdOf.get(station.id as string)!).select("id");
    if (saved.error || !saved.data || saved.data.length === 0) return undo(saved.error);
  }
  refresh();
  return { ok: true, message: `Copied as ${name}.`, stamp: Date.now() };
}
