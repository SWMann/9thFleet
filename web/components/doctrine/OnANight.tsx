import Link from "next/link";
import { TaskList } from "@/components/doctrine/TaskList";
import { readMatrixIfServing } from "@/lib/doctrine";
import { heldFor, stageName, tasksOfRole } from "@/lib/matrix";

/**
 * What a role does and leads on a night, from the responsibility matrix,
 * for a reader of the serving fleet. A visitor sees nothing here: the tasks
 * are the fleet's own. A speciality shows its base role's tasks; a role
 * that others fall back to shows what it holds for them until they exist.
 */
export async function OnANight({ roleId }: { roleId: string }) {
  const matrix = await readMatrixIfServing();
  if (!matrix) return null;
  const role = matrix.roles.get(roleId);
  if (!role) return null;
  const own = tasksOfRole(matrix.tasks, role);
  const held = heldFor(matrix.tasks, matrix.roles, role, matrix.stage);
  if (own.does.length === 0 && own.leads.length === 0 && held.length === 0) return null;
  return (
    <section className="wrap band" aria-labelledby="night">
      <h2 id="night">
        On a <strong>night</strong>
      </h2>
      <p className="intro">
        From the fleet&apos;s responsibility matrix: what this role does, what it leads, and, at {stageName(matrix.stage)}, what it holds for roles that do not exist yet.{" "}
        <Link href="/operations/types">Every type and situation</Link>.
      </p>
      <div className="night-parts">
        {own.does.length > 0 ? (
          <div>
            <h3>Does</h3>
            <TaskList tasks={own.does} matrix={matrix} />
          </div>
        ) : null}
        {own.leads.length > 0 ? (
          <div>
            <h3>Leads</h3>
            <TaskList tasks={own.leads} matrix={matrix} />
          </div>
        ) : null}
        {held.map((entry) => (
          <div key={entry.from.id}>
            <h3>
              Holds for the {entry.from.href ? <Link href={entry.from.href}>{entry.from.name}</Link> : entry.from.name} <span className="muted">until {stageName(entry.from.existsFrom)}</span>
            </h3>
            <TaskList tasks={entry.tasks} matrix={matrix} />
          </div>
        ))}
      </div>
    </section>
  );
}
