"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { refused, turnedDown, type Attempt } from "@/lib/activity";
import { explainRefusal } from "@/lib/refusals";
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
  const makeDefault = formData.get("default") === "on";
  if (!model) return notThisPage(session, "ship.templates");
  if (name.length === 0 || name.length > 60) return { ok: false, message: "Give the template a name of up to 60 characters." };
  // The name first, so that a name already taken changes nothing else.
  const saved = template
    ? await session.supabase.from("crew_templates").update({ name }).eq("id", template).eq("model_id", model).select("id")
    : await session.supabase.from("crew_templates").insert({ model_id: model, name }).select("id");
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

/** Command: set a station on a template: a role and how many of it. A count of zero removes it. */
export async function saveStation(_previous: ShipResult, formData: FormData): Promise<ShipResult> {
  const session = await signedIn();
  if (!session) return NOT_CONNECTED;
  const template = uuid(formData.get("template"));
  const role = uuid(formData.get("role"));
  const count = text(formData.get("count"));
  if (!template || !role) return notThisPage(session, "ship.templates");
  if (!/^\d{1,2}$/.test(count)) return { ok: false, message: "How many is a whole number from 0 to 99." };
  const n = Number(count);
  const result =
    n === 0
      ? await session.supabase.from("crew_template_stations").delete().eq("template_id", template).eq("role_id", role).select("id")
      : await (async () => {
          const changed = await session.supabase.from("crew_template_stations").update({ count: n }).eq("template_id", template).eq("role_id", role).select("id");
          if (changed.error || (changed.data && changed.data.length > 0)) return changed;
          return session.supabase.from("crew_template_stations").insert({ template_id: template, role_id: role, count: n }).select("id");
        })();
  if (result.error) return { ok: false, message: await turnedDown(session.supabase, "ship.templates", result.error, explainRefusal(result.error, "That could not be saved. Command keeps the crew templates.")) };
  if (n > 0 && (!result.data || result.data.length === 0)) return { ok: false, message: await refused(session.supabase, "ship.templates", "That could not be saved. Command keeps the crew templates.") };
  refresh();
  return { ok: true, message: n === 0 ? "Station removed." : "Saved.", stamp: Date.now() };
}
