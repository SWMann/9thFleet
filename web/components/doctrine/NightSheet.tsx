import Link from "next/link";
import { TaskTable } from "@/components/doctrine/TaskTable";
import { readMatrixIfServing } from "@/lib/doctrine";
import { holderAt, liveAt, stageName, tasksOfSituation, tasksOfType, taskStage, type ChainRole } from "@/lib/matrix";
import type { FleetEvent, Roll } from "@/lib/operations";

/**
 * Who does what on this night: the responsibility matrix's tasks for the
 * event's type, each post resolved to the role that holds it at the fleet's
 * stage, and each role to the people manned for it on the roll: in their
 * own post, standing in, or in a post made for the event. The event's
 * commander is the Task Force Commander and their second the task force's
 * executive officer, where those posts exist yet.
 */
export async function NightSheet({ event, roll }: { event: FleetEvent; roll: Roll }) {
  const matrix = await readMatrixIfServing();
  if (!matrix) return null;
  const type = matrix.types.find((entry) => entry.key === event.kind);
  const tasks = tasksOfType(matrix.tasks, event.kind);
  const opens = (key: string) => matrix.types.find((entry) => entry.key === key)?.opensAt ?? 1;

  const namesOf = new Map<string, Set<string>>();
  const add = (roleId: string | null, name: string | null | undefined) => {
    if (!roleId || !name) return;
    const set = namesOf.get(roleId) ?? new Set<string>();
    set.add(name);
    namesOf.set(roleId, set);
  };
  for (const group of roll.groups) {
    for (const post of group.posts) {
      if (post.state === "confirmed") add(post.roleId, post.holder?.name);
      else if (post.state === "stand-in") add(post.roleId, post.standIn?.name);
    }
  }
  for (const extra of roll.extra) add(extra.roleId, extra.holder?.name);
  const bySlug = new Map([...matrix.roles.values()].map((role) => [role.slug, role]));
  const commander = bySlug.get("task-force-commander");
  const second = bySlug.get("task-force-executive-officer");
  if (commander && commander.existsFrom <= matrix.stage) add(commander.id, event.commander?.name);
  if (second && second.existsFrom <= matrix.stage) add(second.id, event.second?.name);
  // A post of a speciality fills its base role's tasks too.
  const people = (roleId: string): string[] => {
    const names = new Set(namesOf.get(roleId) ?? []);
    for (const role of matrix.roles.values()) if (role.specialityOfId === roleId) for (const name of namesOf.get(role.id) ?? []) names.add(name);
    return [...names].sort();
  };

  const live = tasks.filter((task) => taskStage(task, opens) <= matrix.stage);
  const resolved = (roleId: string): ChainRole | null => holderAt(matrix.roles, roleId, matrix.stage)?.role ?? null;
  const manned = live.filter((task) => {
    const does = resolved(task.doesId);
    return does !== null && people(does.id).length > 0;
  }).length;
  const counted = liveAt(tasks, matrix.stage, opens);

  return (
    <>
      <section className="wrap band" aria-labelledby="night">
        <h2 id="night">
          Who does <strong>what</strong>
        </h2>
        <p className="intro">
          {type ? (
            <>
              The tasks of {type.name.toLowerCase() === type.name ? type.name : type.name.charAt(0).toLowerCase() + type.name.slice(1)}
              {": "}
            </>
          ) : (
            "The tasks every operation shares: "
          )}
          {counted.live} live at {stageName(matrix.stage)}, {manned} of them with someone on the roll to do them. Where a post does not exist yet, the role that holds its tasks is named, and where
          nobody on the roll holds a role, the task has nobody tonight. <Link href={type ? `/operations/types/${type.key}` : "/operations/types"}>The type and its tasks</Link>.
        </p>
        <TaskTable tasks={tasks} matrix={matrix} label="Who does what" people={people} />
      </section>
      <section className="wrap band band-last" aria-labelledby="drills">
        <h2 id="drills">
          If it <strong>happens</strong>
        </h2>
        <p className="intro">Every situation that can land on the night, with its drill resolved to the people here.</p>
        <div className="drills">
          {matrix.situations.map((situation) => (
            <details key={situation.slug} className="drill">
              <summary>
                <strong>{situation.name}</strong>
                <span className="lesson-about">{situation.whatYouSee}</span>
              </summary>
              <TaskTable tasks={tasksOfSituation(matrix.tasks, situation.slug)} matrix={matrix} label={situation.name} people={people} phases={false} />
              <p className="hint">
                <Link href={`/operations/situations/${situation.slug}`}>The situation&apos;s page</Link>
              </p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
