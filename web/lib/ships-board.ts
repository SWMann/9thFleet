/**
 * The fleet board: the register summed by model, and the chips that narrow
 * it. Nothing here reads the database.
 */

export type ShipRole = { id: string; slug: string; name: string; description: string; sortOrder: number };
export type ModelRole = { id: string; slug: string; name: string; primary: boolean };

export type BoardModel = { id: string; slug: string; name: string; maker: string; kind: string; roles: ModelRole[] };
export type BoardHull = { model: BoardModel; owner: string; ownerId: string | null; ready: boolean; inClaim: boolean };

export type BoardRow = {
  model: BoardModel;
  hulls: number;
  ready: number;
  inClaim: number;
  /** Seats aboard one hull, by its standard template; nothing if the template is empty. */
  seats: number;
  /** Seats aboard the hulls that are ready. */
  seatsReady: number;
  /** Who owns them, each once, the fleet first. */
  owners: string[];
};

/** The register summed by model, in the order the hulls come. */
export function boardRows(hulls: BoardHull[], seatsOf: (modelId: string) => number): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  for (const hull of hulls) {
    const row = rows.get(hull.model.id) ?? { model: hull.model, hulls: 0, ready: 0, inClaim: 0, seats: seatsOf(hull.model.id), seatsReady: 0, owners: [] };
    row.hulls += 1;
    if (hull.ready) {
      row.ready += 1;
      row.seatsReady += row.seats;
    }
    if (hull.inClaim) row.inClaim += 1;
    if (!row.owners.includes(hull.owner)) {
      if (hull.ownerId === null) row.owners.unshift(hull.owner);
      else row.owners.push(hull.owner);
    }
    rows.set(hull.model.id, row);
  }
  return [...rows.values()];
}

export type Narrowing = { kind: string | null; role: string | null; ready: boolean };

/** What the address asks for: a kind, a role, and whether only what is ready. */
export function narrowingFrom(params: { kind?: string | string[]; role?: string | string[]; ready?: string | string[] }): Narrowing {
  const one = (value: string | string[] | undefined) => (typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value) ? value : null);
  return { kind: one(params.kind), role: one(params.role), ready: one(params.ready) === "1" };
}

/** The rows the narrowing keeps. */
export function narrowed<T extends { model: BoardModel; ready: number }>(rows: T[], asked: Narrowing): T[] {
  return rows.filter(
    (row) => (!asked.kind || row.model.kind === asked.kind) && (!asked.role || row.model.roles.some((role) => role.slug === asked.role)) && (!asked.ready || row.ready > 0),
  );
}

/** The address of the board narrowed as asked. */
export function boardAddress(base: string, asked: Narrowing): string {
  const query = new URLSearchParams();
  if (asked.kind) query.set("kind", asked.kind);
  if (asked.role) query.set("role", asked.role);
  if (asked.ready) query.set("ready", "1");
  const words = query.toString();
  return words ? `${base}?${words}` : base;
}

/** "3 ready, 1 in claim, 2 not ready", leaving out what is zero. */
export function stateWords(row: { hulls: number; ready: number; inClaim: number }): string {
  const parts: string[] = [];
  if (row.ready > 0) parts.push(`${row.ready} ready`);
  if (row.inClaim > 0) parts.push(`${row.inClaim} in claim`);
  const down = row.hulls - row.ready - row.inClaim;
  if (down > 0) parts.push(`${down} not ready`);
  return parts.join(", ");
}
