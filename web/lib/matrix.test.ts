import assert from "node:assert/strict";
import { test } from "node:test";
import { byPhase, heldFor, holderAt, liveAt, matrixStage, tasksOfRole, tasksOfSituation, tasksOfType, taskStage, type ChainRole, type Task } from "./matrix";

const role = (id: string, existsFrom: number, fallbackId: string | null = null, specialityOfId: string | null = null): ChainRole => ({
  id,
  slug: id,
  name: id,
  href: null,
  kind: "primary",
  existsFrom,
  fallbackId,
  specialityOfId,
  echelon: "Ship",
  postType: "rating",
});
const roles = new Map(
  [
    role("gunner", 1),
    role("lead-gunner", 2, "gunner"),
    role("gunnery-officer", 3, "lead-gunner"),
    role("chief-gunner", 4, "gunnery-officer"),
    role("turret-gunner", 2, "gunner", "gunner"),
    role("lost", 4, "missing"),
  ].map((entry) => [entry.id, entry]),
);
const task = (fields: Partial<Task> & { id: string }): Task => ({
  typeKey: null,
  situationSlug: null,
  phase: "underway",
  echelon: "Ship",
  wording: fields.id,
  doesId: "gunner",
  supervisesCommandId: null,
  supervisesTechnicalId: null,
  leadsId: "gunnery-officer",
  neededFrom: 1,
  notes: "",
  sortOrder: 0,
  consulted: [],
  informed: [],
  ...fields,
});

test("a role's tasks are held down the chain until it exists, and the roles passed over are named", () => {
  assert.deepEqual(holderAt(roles, "gunnery-officer", 3)?.role.id, "gunnery-officer");
  const atLaunch = holderAt(roles, "chief-gunner", 1);
  assert.equal(atLaunch?.role.id, "gunner");
  assert.deepEqual(atLaunch?.through.map((entry) => entry.id), ["chief-gunner", "gunnery-officer", "lead-gunner"]);
  assert.equal(holderAt(roles, "chief-gunner", 2)?.role.id, "lead-gunner");
  assert.equal(holderAt(roles, "lost", 1), null);
  assert.equal(holderAt(roles, "nobody", 1), null);
  assert.deepEqual([matrixStage(1), matrixStage(3), matrixStage(4), matrixStage(8), matrixStage(0)], [1, 3, 4, 4, 1]);
});

test("a type's tasks are the spine and its own; a situation's are its drill; a module's stage is its type's", () => {
  const tasks = [
    task({ id: "spine", sortOrder: 1, phase: "planning" }),
    task({ id: "patrol", typeKey: "patrol", neededFrom: null, sortOrder: 2, phase: "planning" }),
    task({ id: "strike", typeKey: "strike", neededFrom: null, sortOrder: 3, phase: "underway" }),
    task({ id: "drill", situationSlug: "casualty", phase: "drill", sortOrder: 4, neededFrom: 2 }),
    task({ id: "spine-late", sortOrder: 5, phase: "after", neededFrom: 4 }),
  ];
  const opens = (key: string) => (key === "strike" ? 3 : 1);
  assert.deepEqual(tasksOfType(tasks, "patrol").map((entry) => entry.id), ["spine", "patrol", "spine-late"]);
  assert.deepEqual(tasksOfType(tasks, "strike").map((entry) => entry.id), ["spine", "strike", "spine-late"]);
  assert.deepEqual(tasksOfSituation(tasks, "casualty").map((entry) => entry.id), ["drill"]);
  assert.deepEqual([taskStage(tasks[1], opens), taskStage(tasks[2], opens), taskStage(tasks[3], opens)], [1, 3, 2]);
  assert.deepEqual(byPhase(tasksOfType(tasks, "strike")).map((group) => `${group.name}: ${group.tasks.map((entry) => entry.id).join(" ")}`), ["Planning: spine", "Underway: strike", "After: spine-late"]);
  assert.deepEqual(liveAt(tasksOfType(tasks, "strike"), 1, opens), { live: 1, later: 2 });
});

test("a role's tasks are what it does and leads; a speciality inherits its base's; a role holds others' until they exist", () => {
  const tasks = [
    task({ id: "fire", sortOrder: 1, doesId: "gunner", leadsId: "gunnery-officer" }),
    task({ id: "direct", sortOrder: 2, doesId: "gunnery-officer", leadsId: "gunnery-officer" }),
    task({ id: "standards", sortOrder: 3, doesId: "chief-gunner", leadsId: "chief-gunner" }),
  ];
  const gunner = roles.get("gunner")!;
  assert.deepEqual(tasksOfRole(tasks, gunner).does.map((entry) => entry.id), ["fire"]);
  assert.deepEqual(tasksOfRole(tasks, gunner).leads, []);
  const officer = roles.get("gunnery-officer")!;
  assert.deepEqual(tasksOfRole(tasks, officer).does.map((entry) => entry.id), ["direct"]);
  assert.deepEqual(tasksOfRole(tasks, officer).leads.map((entry) => entry.id), ["fire"]);
  assert.deepEqual(tasksOfRole(tasks, roles.get("turret-gunner")!).does.map((entry) => entry.id), ["fire"]);
  // At launch the gunner holds what the lead, the officer and the chief would do.
  assert.deepEqual(heldFor(tasks, roles, gunner, 1).map((entry) => `${entry.from.id}: ${entry.tasks.map((task) => task.id).join(" ")}`), ["gunnery-officer: fire direct", "chief-gunner: standards"]);
  assert.deepEqual(heldFor(tasks, roles, gunner, 3).map((entry) => entry.from.id), []);
  assert.deepEqual(heldFor(tasks, roles, officer, 3).map((entry) => entry.from.id), ["chief-gunner"]);
});
