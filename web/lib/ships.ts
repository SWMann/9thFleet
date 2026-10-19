import "server-only";
import { getSession, isServing, type Member, type Status } from "@/lib/member";
import { shipKindOf, shipKinds } from "@/lib/structure";
import { createClient } from "@/lib/supabase/server";

/**
 * The ship register, read as the member asking. The database sends the
 * register to the serving fleet, each owner's note to the owner and command,
 * and the models and crew templates to the fleet and staff.
 */

export type ShipModel = {
  id: string;
  slug: string;
  name: string;
  maker: string;
  kind: string;
  crewMin: number;
  crewMax: number;
  flyable: boolean;
  sortOrder: number;
};

export type Station = { roleId: string; role: string; count: number };
export type CrewTemplate = { id: string; modelId: string; name: string; isDefault: boolean; stations: Station[]; seats: number };

export type Ship = {
  id: string;
  model: ShipModel;
  ownerId: string | null;
  owner: string;
  name: string;
  ready: boolean;
  readyAsOf: string;
  registeredAt: string;
  /** The reader's own, or one of the fleet's that command keeps. */
  mine: boolean;
  /** The owner's note, where the database sends it. */
  note: string | null;
};

export type Named = { id: string; name: string };

type Row = Record<string, unknown>;
type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;
const SERVING: Status[] = ["recruit", "auxiliary", "member", "reserve"];
/** The most rows the database sends in one reply. More are read a page at a time. */
const PAGE = 1000;

/** Every row of a query, read a page at a time, for tables that outgrow one reply as the fleet grows. `query` orders the rows. */
async function allRows(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(from, from + PAGE - 1);
    if (page.error) throw new Error(`${what} could not be read: ${page.error.message}`);
    const found = (page.data ?? []) as Row[];
    rows.push(...found);
    if (found.length < PAGE) return rows;
  }
}

/** Every ship on the register, as the database sends them to the reader. */
const allShips = (supabase: Client) =>
  allRows((from, to) => supabase.from("ships").select("id, model_id, owner_id, name, ready, ready_as_of, registered_at").order("registered_at").order("id").range(from, to), "The register");

const toModel = (row: Row): ShipModel => ({
  id: row.id as string,
  slug: row.slug as string,
  name: row.name as string,
  maker: (row.maker as string) ?? "",
  kind: row.kind as string,
  crewMin: Number(row.crew_min),
  crewMax: Number(row.crew_max),
  flyable: row.flyable === true,
  sortOrder: Number(row.sort_order ?? 0),
});

const kindOrder = new Map(shipKinds.map((kind, index) => [kind.key, index]));
/** Models in the register's order: by kind, then by their place, then by name. */
export const byModel = (a: ShipModel, b: ShipModel) =>
  (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** Every model, and every crew template with its stations. */
export async function getModels(supabase: Client): Promise<{ models: ShipModel[]; templates: CrewTemplate[] }> {
  const [models, templates, stations, roles] = await Promise.all([
    supabase.from("ship_models").select("id, slug, name, maker, kind, crew_min, crew_max, flyable, sort_order"),
    supabase.from("crew_templates").select("id, model_id, name, is_default"),
    supabase.from("crew_template_stations").select("template_id, role_id, count, sort_order"),
    supabase.from("fleet_roles").select("id, name"),
  ]);
  for (const result of [models, templates, stations, roles]) {
    if (result.error) throw new Error(`The ship models could not be read: ${result.error.message}`);
  }
  const roleName = new Map(((roles.data ?? []) as Row[]).map((row) => [row.id as string, row.name as string]));
  const stationsOf = new Map<string, Station[]>();
  for (const row of ((stations.data ?? []) as Row[]).sort((a, b) => Number(a.sort_order) - Number(b.sort_order))) {
    const list = stationsOf.get(row.template_id as string) ?? [];
    list.push({ roleId: row.role_id as string, role: roleName.get(row.role_id as string) ?? "A role", count: Number(row.count) });
    stationsOf.set(row.template_id as string, list);
  }
  return {
    models: ((models.data ?? []) as Row[]).map(toModel).sort(byModel),
    templates: ((templates.data ?? []) as Row[])
      .map((row) => {
        const list = stationsOf.get(row.id as string) ?? [];
        return { id: row.id as string, modelId: row.model_id as string, name: row.name as string, isDefault: row.is_default === true, stations: list, seats: list.reduce((sum, station) => sum + station.count, 0) };
      })
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
  };
}

/** Each member's name, by id, as the fleet's records give it, and who is serving. */
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

type Outside = { state: "no-database" } | { state: "signed-out" } | { state: "no-record" } | { state: "outside" };

export type Register =
  | Outside
  | {
      state: "ready";
      member: Member;
      command: boolean;
      /** Every ship on the register, the reader's own first, then by model. */
      ships: Ship[];
      models: ShipModel[];
      templates: CrewTemplate[];
      /** For command: everyone serving, to register a hull for. */
      serving: Named[];
      /** By kind: how many hulls are registered and how many are ready. */
      strength: { kind: string; name: string; hulls: number; ready: number }[];
      /** When the register was read, which "marked 3 days ago" counts from. */
      readAt: number;
    };

export async function getRegister(): Promise<Register> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  const member = session.member;
  if (!isServing(member)) return { state: "outside" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const command = member.roles.includes("command") || member.roles.includes("admin");

  const [catalogue, fleet, ships, notes] = await Promise.all([
    getModels(supabase),
    fleetNames(supabase),
    allShips(supabase),
    allRows((from, to) => supabase.from("ship_notes").select("ship_id, note").order("ship_id").range(from, to), "The register"),
  ]);
  const modelOf = new Map(catalogue.models.map((model) => [model.id, model]));
  const noteOf = new Map(notes.map((row) => [row.ship_id as string, row.note as string]));
  const servingIds = new Set(fleet.serving.map((person) => person.id));
  // A hull whose owner has left the serving fleet is theirs still, but not the fleet's to count on.
  const list: Ship[] = ships
    .filter((row) => row.owner_id === null || servingIds.has(row.owner_id as string))
    .map((row) => {
      const ownerId = (row.owner_id as string | null) ?? null;
      return {
        id: row.id as string,
        model: modelOf.get(row.model_id as string) ?? { id: row.model_id as string, slug: "", name: "A model that is gone", maker: "", kind: "runabout", crewMin: 1, crewMax: 1, flyable: false, sortOrder: 999 },
        ownerId,
        owner: ownerId ? (fleet.names[ownerId] ?? "a former member") : "The fleet",
        name: (row.name as string) ?? "",
        ready: row.ready === true,
        readyAsOf: row.ready_as_of as string,
        registeredAt: row.registered_at as string,
        mine: ownerId === member.id || (ownerId === null && command),
        note: noteOf.has(row.id as string) ? noteOf.get(row.id as string)! : null,
      };
    })
    .sort((a, b) => Number(b.ownerId === member.id) - Number(a.ownerId === member.id) || byModel(a.model, b.model) || a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));

  const strength = shipKinds
    .map((kind) => {
      const hulls = list.filter((ship) => ship.model.kind === kind.key);
      return { kind: kind.key, name: kind.many, hulls: hulls.length, ready: hulls.filter((ship) => ship.ready).length };
    })
    .filter((line) => line.hulls > 0);

  return {
    state: "ready",
    member,
    command,
    ships: list,
    models: catalogue.models,
    templates: catalogue.templates,
    serving: command ? fleet.serving : [],
    strength,
    readAt: Date.now(),
  };
}

/**
 * Readiness for one event: what the plan wants by model against what is
 * offered, and the seats aboard what is offered against who is attending and
 * which roles they are qualified for.
 */
export type Readiness = {
  /** Each line of the plan, with the offered hulls of its model shared out across the lines that name it, in order. */
  wanted: { model: ShipModel | null; name: string; count: number; offered: number }[];
  /** What the plan wants and what is offered, summed by model, which is how the shortfall is counted. */
  byModel: { model: ShipModel; wanted: number; offered: number }[];
  offered: { ship: Ship; template: CrewTemplate | null }[];
  /** Seats aboard what is offered, by role: how many, and how many of those attending can fill the role. */
  seats: { role: string; roleId: string; seats: number; qualified: number }[];
  totalSeats: number;
  attending: number;
  /** The reader's own ready ships, and the fleet's for command, with those already offered and whether each may be offered now. */
  mine: { ship: Ship; offered: boolean; may: boolean }[];
};

/**
 * Who among those attending can fill a station: someone holding a post of
 * that role now, or holding every qualification some post of the role asks
 * for, and every qualification the role itself asks for. A role whose posts
 * ask for nothing is filled by its holders alone.
 */
function fillers(
  attending: string[],
  roleOf: Map<string, string>,
  held: Map<string, Set<string>>,
  posts: { memberId: string; positionId: string }[],
  positionNeeds: Map<string, string[]>,
  roleNeeds: Map<string, string[]>,
): (roleId: string) => number {
  const holdersOf = new Map<string, Set<string>>();
  for (const post of posts) {
    const role = roleOf.get(post.positionId);
    if (!role) continue;
    const set = holdersOf.get(role) ?? new Set<string>();
    set.add(post.memberId);
    holdersOf.set(role, set);
  }
  const asksOf = new Map<string, string[][]>();
  for (const [positionId, role] of roleOf) {
    const asks = positionNeeds.get(positionId) ?? [];
    if (asks.length > 0) asksOf.set(role, [...(asksOf.get(role) ?? []), asks]);
  }
  const holds = (id: string, qualifications: string[]) => qualifications.every((qualification) => held.get(id)?.has(qualification));
  return (roleId) =>
    attending.filter((id) => {
      if (holdersOf.get(roleId)?.has(id)) return true;
      if (!holds(id, roleNeeds.get(roleId) ?? [])) return false;
      return (asksOf.get(roleId) ?? []).some((asks) => holds(id, asks));
    }).length;
}

export async function getReadiness(supabase: Client, eventId: string, member: Member, command: boolean, attending: string[], rollOpen: boolean): Promise<Readiness> {
  const [catalogue, fleet, wanted, offers, ships, holders, needs, positions, posts, positionNeeds] = await Promise.all([
    getModels(supabase),
    fleetNames(supabase),
    supabase.from("event_ships").select("id, ship, model_id, count, sort_order").eq("event_id", eventId),
    supabase.from("event_ship_offers").select("ship_id, member_id").eq("event_id", eventId),
    allShips(supabase),
    attending.length > 0
      ? allRows((from, to) => supabase.from("qualification_awards").select("member_id, qualification_id").in("member_id", attending).order("id").range(from, to), "The event's readiness")
      : Promise.resolve([] as Row[]),
    supabase.from("fleet_role_qualifications").select("role_id, qualification_id"),
    supabase.from("positions").select("id, role_id"),
    attending.length > 0
      ? allRows((from, to) => supabase.from("assignments").select("member_id, position_id").in("member_id", attending).eq("kind", "primary").is("ended_on", null).order("id").range(from, to), "The event's readiness")
      : Promise.resolve([] as Row[]),
    supabase.from("position_qualifications").select("position_id, qualification_id"),
  ]);
  for (const result of [wanted, offers, needs, positions, positionNeeds]) {
    if (result.error) throw new Error(`The event's readiness could not be read: ${result.error.message}`);
  }
  const modelOf = new Map(catalogue.models.map((model) => [model.id, model]));
  const standard = new Map(catalogue.templates.filter((template) => template.isDefault).map((template) => [template.modelId, template]));
  const shipOf = new Map(
    ships.map((row): [string, Ship] => {
      const ownerId = (row.owner_id as string | null) ?? null;
      return [
        row.id as string,
        {
          id: row.id as string,
          model: modelOf.get(row.model_id as string) ?? { id: row.model_id as string, slug: "", name: "A model that is gone", maker: "", kind: "runabout", crewMin: 1, crewMax: 1, flyable: false, sortOrder: 999 },
          ownerId,
          owner: ownerId ? (fleet.names[ownerId] ?? "a former member") : "The fleet",
          name: (row.name as string) ?? "",
          ready: row.ready === true,
          readyAsOf: row.ready_as_of as string,
          registeredAt: row.registered_at as string,
          mine: ownerId === member.id || (ownerId === null && command),
          note: null,
        },
      ];
    }),
  );
  const offeredIds = new Set(((offers.data ?? []) as Row[]).map((row) => row.ship_id as string));
  const offered = [...offeredIds]
    .map((id) => shipOf.get(id))
    .filter((ship): ship is Ship => Boolean(ship))
    .map((ship) => ({ ship, template: standard.get(ship.model.id) ?? null }))
    .sort((a, b) => byModel(a.ship.model, b.ship.model) || a.ship.owner.localeCompare(b.ship.owner));
  const offeredByModel = new Map<string, number>();
  for (const line of offered) offeredByModel.set(line.ship.model.id, (offeredByModel.get(line.ship.model.id) ?? 0) + 1);

  // Who among those attending can fill each station.
  const needsOf = new Map<string, string[]>();
  for (const row of (needs.data ?? []) as Row[]) needsOf.set(row.role_id as string, [...(needsOf.get(row.role_id as string) ?? []), row.qualification_id as string]);
  const asksOf = new Map<string, string[]>();
  for (const row of (positionNeeds.data ?? []) as Row[]) asksOf.set(row.position_id as string, [...(asksOf.get(row.position_id as string) ?? []), row.qualification_id as string]);
  const heldBy = new Map<string, Set<string>>();
  for (const row of holders) {
    const set = heldBy.get(row.member_id as string) ?? new Set<string>();
    set.add(row.qualification_id as string);
    heldBy.set(row.member_id as string, set);
  }
  const roleOf = new Map(((positions.data ?? []) as Row[]).filter((row) => row.role_id).map((row) => [row.id as string, row.role_id as string]));
  const qualifiedFor = fillers(
    attending,
    roleOf,
    heldBy,
    posts.map((row) => ({ memberId: row.member_id as string, positionId: row.position_id as string })),
    asksOf,
    needsOf,
  );
  const seatsByRole = new Map<string, { role: string; seats: number }>();
  for (const line of offered) {
    for (const station of line.template?.stations ?? []) {
      const entry = seatsByRole.get(station.roleId) ?? { role: station.role, seats: 0 };
      entry.seats += station.count;
      seatsByRole.set(station.roleId, entry);
    }
  }
  const seats = [...seatsByRole.entries()].map(([roleId, entry]) => ({ roleId, role: entry.role, seats: entry.seats, qualified: qualifiedFor(roleId) })).sort((a, b) => b.seats - a.seats || a.role.localeCompare(b.role));

  // What the plan wants, line by line, with each model's offered hulls shared out across its lines in order.
  const remaining = new Map(offeredByModel);
  const lines = ((wanted.data ?? []) as Row[])
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .map((row) => {
      const model = row.model_id ? (modelOf.get(row.model_id as string) ?? null) : null;
      const count = Number(row.count ?? 1);
      const given = model ? Math.min(count, remaining.get(model.id) ?? 0) : 0;
      if (model) remaining.set(model.id, (remaining.get(model.id) ?? 0) - given);
      return { model, name: row.ship as string, count, offered: given };
    });
  const wantedByModel = new Map<string, number>();
  for (const line of lines) if (line.model) wantedByModel.set(line.model.id, (wantedByModel.get(line.model.id) ?? 0) + line.count);
  const attendingSet = new Set(attending);
  return {
    wanted: lines,
    // In the plan's own order.
    byModel: [...wantedByModel.entries()].map(([modelId, count]) => ({ model: modelOf.get(modelId)!, wanted: count, offered: offeredByModel.get(modelId) ?? 0 })),
    offered,
    seats,
    totalSeats: seats.reduce((sum, line) => sum + line.seats, 0),
    attending: attending.length,
    // An owner offers their own ships once they are attending; command offers the fleet's whether or not they are.
    mine: [...shipOf.values()]
      .filter((ship) => ship.mine && ship.ready)
      .sort((a, b) => byModel(a.model, b.model) || a.name.localeCompare(b.name))
      .map((ship) => ({ ship, offered: offeredIds.has(ship.id), may: rollOpen && (ship.ownerId === null ? command : attendingSet.has(member.id)) })),
  };
}

/** A short name for a ship on a page: its name, or its model and owner. */
export const shipLabel = (ship: Ship) => (ship.name ? `${ship.name} (${ship.model.name})` : `${ship.model.name}, ${ship.owner}`);
export { shipKindOf };
