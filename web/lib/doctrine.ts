import "server-only";
import { getSession, isServing, isStaff, type Member } from "@/lib/member";
import { matrixStage, tasksOfSituation, tasksOfType, type ChainRole, type Party, type Phase, type Task } from "@/lib/matrix";
import { createClient } from "@/lib/supabase/server";

/**
 * The responsibility matrix as the database holds it: the roles with their
 * chain, the operation types with their facts, the situations and the
 * tasks. Read with the reader's own access: the roles are everyone's, the
 * rest the serving fleet's and staff's.
 */

export type OperationType = {
  id: string;
  key: string;
  name: string;
  family: string;
  aim: string;
  opensAt: number;
  needs: string;
  minimumForce: string;
  typicalForce: string;
  plannedOrReactive: string;
  contactExpected: string;
  notes: string;
  sortOrder: number;
};

export type Situation = {
  id: string;
  slug: string;
  name: string;
  whatYouSee: string;
  callsId: string | null;
  ownsId: string | null;
  notes: string;
  sortOrder: number;
};

export type Matrix = {
  roles: Map<string, ChainRole>;
  types: OperationType[];
  situations: Situation[];
  tasks: Task[];
  /** The fleet's stage as the matrix counts it. */
  stage: number;
  siteStage: number;
};

type Row = Record<string, unknown>;
type Client = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** The roles as the chain needs them, with the area each belongs to for its page. Everyone may read these. */
export async function readChainRoles(supabase: Client): Promise<Map<string, ChainRole>> {
  const [roles, areas] = await Promise.all([
    supabase.from("fleet_roles").select("id, slug, name, area_id, kind, exists_from, fallback_role_id, speciality_of_role_id, echelon, post_type"),
    supabase.from("areas").select("id, slug"),
  ]);
  if (roles.error) throw new Error(`The roles could not be read: ${roles.error.message}`);
  if (areas.error) throw new Error(`The areas could not be read: ${areas.error.message}`);
  const areaSlug = new Map(((areas.data ?? []) as Row[]).map((row) => [row.id as string, row.slug as string]));
  return new Map(
    ((roles.data ?? []) as Row[]).map((row): [string, ChainRole] => {
      const area = areaSlug.get(row.area_id as string);
      return [
        row.id as string,
        {
          id: row.id as string,
          slug: row.slug as string,
          name: row.name as string,
          href: area ? `/roles/${area}/${row.slug as string}` : null,
          kind: row.kind === "duty" ? "duty" : "primary",
          existsFrom: Number(row.exists_from ?? 1),
          fallbackId: (row.fallback_role_id as string | null) ?? null,
          specialityOfId: (row.speciality_of_role_id as string | null) ?? null,
          echelon: (row.echelon as string) ?? "",
          postType: ((row.post_type as string) ?? "") as ChainRole["postType"],
        },
      ];
    }),
  );
}

const toType = (row: Row): OperationType => ({
  id: row.id as string,
  key: row.key as string,
  name: row.name as string,
  family: (row.family as string) ?? "",
  aim: (row.aim as string) ?? "",
  opensAt: Number(row.opens_at ?? 1),
  needs: (row.needs as string) ?? "",
  minimumForce: (row.minimum_force as string) ?? "",
  typicalForce: (row.typical_force as string) ?? "",
  plannedOrReactive: (row.planned_or_reactive as string) ?? "",
  contactExpected: (row.contact_expected as string) ?? "",
  notes: (row.notes as string) ?? "",
  sortOrder: Number(row.sort_order ?? 0),
});

/** The whole matrix, read as the signed-in member. Tasks and situations arrive only for the serving fleet and staff. */
export async function readMatrix(supabase: Client, siteStage: number): Promise<Matrix> {
  const [roles, types, situations, tasks, links] = await Promise.all([
    readChainRoles(supabase),
    supabase.from("event_types").select("id, key, name, family, aim, opens_at, needs, minimum_force, typical_force, planned_or_reactive, contact_expected, notes, sort_order"),
    supabase.from("situations").select("id, slug, name, what_you_see, calls_role_id, owns_role_id, notes, sort_order"),
    supabase.from("tasks").select("id, event_type_id, situation_id, phase, echelon, wording, does_role_id, supervises_command_role_id, supervises_technical_role_id, leads_role_id, needed_from, notes, sort_order"),
    supabase.from("task_roles").select("task_id, part, role_id, token, sort_order"),
  ]);
  for (const result of [types, situations, tasks, links]) {
    if (result.error) throw new Error(`The matrix could not be read: ${result.error.message}`);
  }
  const typeList = ((types.data ?? []) as Row[]).map(toType).sort((a, b) => a.sortOrder - b.sortOrder);
  const typeKey = new Map(typeList.map((type) => [type.id, type.key]));
  const situationList: Situation[] = ((situations.data ?? []) as Row[])
    .map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      whatYouSee: (row.what_you_see as string) ?? "",
      callsId: (row.calls_role_id as string | null) ?? null,
      ownsId: (row.owns_role_id as string | null) ?? null,
      notes: (row.notes as string) ?? "",
      sortOrder: Number(row.sort_order ?? 0),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const situationSlug = new Map(situationList.map((situation) => [situation.id, situation.slug]));
  const parties = new Map<string, { consulted: { party: Party; order: number }[]; informed: { party: Party; order: number }[] }>();
  for (const row of (links.data ?? []) as Row[]) {
    const entry = parties.get(row.task_id as string) ?? { consulted: [], informed: [] };
    const party: Party = row.role_id ? { kind: "role", roleId: row.role_id as string } : { kind: "token", token: row.token as "whole_force" | "ships_company" };
    entry[row.part === "consulted" ? "consulted" : "informed"].push({ party, order: Number(row.sort_order ?? 0) });
    parties.set(row.task_id as string, entry);
  }
  const inOrder = (list: { party: Party; order: number }[]) => list.sort((a, b) => a.order - b.order).map((entry) => entry.party);
  const taskList: Task[] = ((tasks.data ?? []) as Row[]).map((row) => {
    const linked = parties.get(row.id as string);
    return {
      id: row.id as string,
      typeKey: row.event_type_id ? (typeKey.get(row.event_type_id as string) ?? null) : null,
      situationSlug: row.situation_id ? (situationSlug.get(row.situation_id as string) ?? null) : null,
      phase: row.phase as Phase,
      echelon: (row.echelon as string) ?? "",
      wording: row.wording as string,
      doesId: row.does_role_id as string,
      supervisesCommandId: (row.supervises_command_role_id as string | null) ?? null,
      supervisesTechnicalId: (row.supervises_technical_role_id as string | null) ?? null,
      leadsId: row.leads_role_id as string,
      neededFrom: row.needed_from === null || row.needed_from === undefined ? null : Number(row.needed_from),
      notes: (row.notes as string) ?? "",
      sortOrder: Number(row.sort_order ?? 0),
      consulted: linked ? inOrder(linked.consulted) : [],
      informed: linked ? inOrder(linked.informed) : [],
    };
  });
  return { roles, types: typeList, situations: situationList, tasks: taskList, stage: matrixStage(siteStage), siteStage };
}

type Outside = { state: "no-database" } | { state: "signed-out" } | { state: "no-record" } | { state: "outside" };

export type Doctrine = Outside | { state: "ready"; member: Member; matrix: Matrix };

/** The matrix for a page of the serving fleet's. */
export async function getDoctrine(): Promise<Doctrine> {
  const session = await getSession();
  if (session.state !== "member") return { state: session.state };
  if (!isServing(session.member) && !isStaff(session.member)) return { state: "outside" };
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const setting = await supabase.from("fleet_settings").select("current_stage").limit(1);
  const siteStage = Number(setting.data?.[0]?.current_stage ?? 1);
  return { state: "ready", member: session.member, matrix: await readMatrix(supabase, siteStage) };
}

/** One type's page: the type, and its tasks with the spine. */
export async function getTypePage(key: string): Promise<Outside | { state: "not-found" } | { state: "ready"; member: Member; matrix: Matrix; type: OperationType; tasks: Task[] }> {
  const doctrine = await getDoctrine();
  if (doctrine.state !== "ready") return doctrine;
  const type = doctrine.matrix.types.find((entry) => entry.key === key);
  if (!type) return { state: "not-found" };
  return { ...doctrine, type, tasks: tasksOfType(doctrine.matrix.tasks, key) };
}

/** One situation's page: the situation and its drill. */
export async function getSituationPage(slug: string): Promise<Outside | { state: "not-found" } | { state: "ready"; member: Member; matrix: Matrix; situation: Situation; tasks: Task[] }> {
  const doctrine = await getDoctrine();
  if (doctrine.state !== "ready") return doctrine;
  const situation = doctrine.matrix.situations.find((entry) => entry.slug === slug);
  if (!situation) return { state: "not-found" };
  return { ...doctrine, situation, tasks: tasksOfSituation(doctrine.matrix.tasks, slug) };
}

/**
 * The matrix for a reader who may or may not be serving: the roles for
 * everyone, the tasks only where the reader is of the serving fleet or
 * staff. For pages that are public, such as a role's.
 */
export async function readMatrixIfServing(): Promise<Matrix | null> {
  const session = await getSession();
  if (session.state !== "member") return null;
  if (!isServing(session.member) && !isStaff(session.member)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const setting = await supabase.from("fleet_settings").select("current_stage").limit(1);
  return readMatrix(supabase, Number(setting.data?.[0]?.current_stage ?? 1));
}
