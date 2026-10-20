/**
 * The responsibility matrix as words and rules: the fallback chain, the
 * stages, the phases, and which tasks belong to a type, a situation or a
 * role. Nothing here reads the database.
 */

export type Phase = "planning" | "muster" | "underway" | "recovery" | "after" | "drill";
export const PHASES: { key: Phase; name: string }[] = [
  { key: "planning", name: "Planning" },
  { key: "muster", name: "Muster and brief" },
  { key: "underway", name: "Underway" },
  { key: "recovery", name: "Recovery" },
  { key: "after", name: "After" },
  { key: "drill", name: "The drill" },
];
export const phaseName = (phase: Phase) => PHASES.find((entry) => entry.key === phase)?.name ?? phase;

/** The matrix's four stages, and what each is. */
export const STAGES: { stage: number; name: string; size: string }[] = [
  { stage: 1, name: "Launch", size: "the first members" },
  { stage: 2, name: "Stage 2", size: "about 16" },
  { stage: 3, name: "Stage 3", size: "about 60" },
  { stage: 4, name: "Fleet", size: "hundreds, across time zones" },
];
export const stageName = (stage: number) => STAGES.find((entry) => entry.stage === stage)?.name ?? `Stage ${stage}`;

/** The site's stage as the matrix counts it: its first three are the matrix's, and everything from the fourth is the fleet stage. */
export const matrixStage = (siteStage: number) => Math.max(1, Math.min(4, siteStage));

/** A role as the chain needs it. */
export type ChainRole = {
  id: string;
  slug: string;
  name: string;
  /** The role's page, where it has one. */
  href: string | null;
  kind: "primary" | "duty";
  existsFrom: number;
  fallbackId: string | null;
  specialityOfId: string | null;
  echelon: string;
  postType: "" | "officer" | "rating" | "either";
};

/** Who is consulted or informed: a role, or everyone. */
export type Party = { kind: "role"; roleId: string } | { kind: "token"; token: "whole_force" | "ships_company" };
export const tokenWords = (token: "whole_force" | "ships_company") => (token === "whole_force" ? "The whole force" : "The ship's company");

export type Task = {
  id: string;
  /** Empty for a task of every operation. */
  typeKey: string | null;
  situationSlug: string | null;
  phase: Phase;
  echelon: string;
  wording: string;
  doesId: string;
  supervisesCommandId: string | null;
  supervisesTechnicalId: string | null;
  leadsId: string;
  /** Empty for a module's task, which takes its type's stage. */
  neededFrom: number | null;
  notes: string;
  sortOrder: number;
  consulted: Party[];
  informed: Party[];
};

/**
 * Who holds a role's tasks at a stage: the role itself once it exists, or
 * the first role down its fallback chain that does. The roles passed over
 * are returned too, so a page can say "held by the XO until stage 3".
 * Nothing, if the chain never reaches a role that exists.
 */
export function holderAt(roles: Map<string, ChainRole>, roleId: string, stage: number): { role: ChainRole; through: ChainRole[] } | null {
  const through: ChainRole[] = [];
  let at = roles.get(roleId) ?? null;
  for (let hops = 0; at && hops < 12; hops += 1) {
    if (at.existsFrom <= stage) return { role: at, through };
    through.push(at);
    at = at.fallbackId ? (roles.get(at.fallbackId) ?? null) : null;
  }
  return null;
}

/** The stage a task first exists at: its own, or its type's. */
export const taskStage = (task: Task, typeOpensAt: (key: string) => number) => task.neededFrom ?? (task.typeKey ? typeOpensAt(task.typeKey) : 1);

/** The tasks of one operation type: the spine every operation shares, then the type's own, by phase and in order. */
export function tasksOfType(tasks: Task[], typeKey: string): Task[] {
  return tasks.filter((task) => task.situationSlug === null && (task.typeKey === null || task.typeKey === typeKey)).sort(byPhaseThenOrder);
}

/** The drill of one situation. */
export const tasksOfSituation = (tasks: Task[], slug: string) => tasks.filter((task) => task.situationSlug === slug).sort(byPhaseThenOrder);

const phaseIndex = new Map(PHASES.map((entry, index) => [entry.key, index]));
export const byPhaseThenOrder = (a: Task, b: Task) => (phaseIndex.get(a.phase) ?? 9) - (phaseIndex.get(b.phase) ?? 9) || a.sortOrder - b.sortOrder;

/** The tasks grouped by phase, in the phases' order, leaving out empty phases. */
export function byPhase(tasks: Task[]): { phase: Phase; name: string; tasks: Task[] }[] {
  return PHASES.map((entry) => ({ phase: entry.key, name: entry.name, tasks: tasks.filter((task) => task.phase === entry.key).sort((a, b) => a.sortOrder - b.sortOrder) })).filter((group) => group.tasks.length > 0);
}

/** Whether a task names a role as the one who does it or leads it. A speciality is named by its base role's tasks too. */
export function namesRole(task: Task, role: ChainRole, part: "does" | "leads"): boolean {
  const ids = [role.id, ...(role.specialityOfId ? [role.specialityOfId] : [])];
  return ids.includes(part === "does" ? task.doesId : task.leadsId);
}

/** A role's tasks: what it does and what it leads, each list in phase order, with a speciality inheriting its base's. */
export function tasksOfRole(tasks: Task[], role: ChainRole): { does: Task[]; leads: Task[] } {
  return {
    does: tasks.filter((task) => namesRole(task, role, "does")).sort(byPhaseThenOrder),
    leads: tasks.filter((task) => namesRole(task, role, "leads") && !namesRole(task, role, "does")).sort(byPhaseThenOrder),
  };
}

/** The tasks a role holds at a stage for roles that do not exist yet: those of every role whose chain resolves to it. */
export function heldFor(tasks: Task[], roles: Map<string, ChainRole>, role: ChainRole, stage: number): { from: ChainRole; tasks: Task[] }[] {
  const held: { from: ChainRole; tasks: Task[] }[] = [];
  for (const other of roles.values()) {
    if (other.id === role.id || other.existsFrom <= stage) continue;
    if (holderAt(roles, other.id, stage)?.role.id !== role.id) continue;
    const own = tasks.filter((task) => task.doesId === other.id || task.leadsId === other.id).sort(byPhaseThenOrder);
    if (own.length > 0) held.push({ from: other, tasks: own });
  }
  return held.sort((a, b) => a.from.existsFrom - b.from.existsFrom || a.from.name.localeCompare(b.from.name));
}

/** A type's tasks counted by whether they exist at a stage. */
export function liveAt(tasks: Task[], stage: number, typeOpensAt: (key: string) => number): { live: number; later: number } {
  let live = 0;
  let later = 0;
  for (const task of tasks) if (taskStage(task, typeOpensAt) <= stage) live += 1; else later += 1;
  return { live, later };
}
