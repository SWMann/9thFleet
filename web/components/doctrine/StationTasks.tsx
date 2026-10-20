import Link from "next/link";
import { TaskList } from "@/components/doctrine/TaskList";
import { readMatrixIfServing } from "@/lib/doctrine";
import { heldFor, stageName, tasksOfRole } from "@/lib/matrix";
import { stationName, type CrewTemplate } from "@/lib/ships";

/**
 * What each station of a model does on a night, from the responsibility
 * matrix: the tasks of the station's role, a speciality's being its base
 * role's, and at the fleet's stage what the role holds for roles that do
 * not exist yet. One entry per station, in the templates' order, a role
 * that several stations share shown once.
 */
export async function StationTasks({ templates }: { templates: CrewTemplate[] }) {
  const matrix = await readMatrixIfServing();
  if (!matrix) return null;
  const seen = new Set<string>();
  const entries: { key: string; name: string; template: string; href: string | null; does: ReturnType<typeof tasksOfRole>["does"]; leads: ReturnType<typeof tasksOfRole>["leads"]; held: ReturnType<typeof heldFor> }[] = [];
  for (const template of templates) {
    for (const station of template.stations) {
      if (seen.has(station.roleId)) continue;
      seen.add(station.roleId);
      const role = matrix.roles.get(station.roleId);
      if (!role) continue;
      const own = tasksOfRole(matrix.tasks, role);
      const held = heldFor(matrix.tasks, matrix.roles, role, matrix.stage);
      if (own.does.length === 0 && own.leads.length === 0 && held.length === 0) continue;
      entries.push({ key: station.id, name: stationName(station), template: template.name, href: role.href, does: own.does, leads: own.leads, held });
    }
  }
  if (entries.length === 0) return null;
  return (
    <section className="wrap band" aria-labelledby="station-tasks">
      <h2 id="station-tasks">
        Each station on a <strong>night</strong>
      </h2>
      <p className="intro">
        From the fleet&apos;s responsibility matrix: what the role at each station does and leads, and at {stageName(matrix.stage)} what it holds for roles that do not exist yet. A station
        named for a speciality does what its base role does. <Link href="/operations/types">Every type and situation</Link>.
      </p>
      <div className="drills station-tasks">
        {entries.map((entry) => (
          <details className="drill" key={entry.key}>
            <summary>
              <strong>{entry.name}</strong>
              <span className="muted">
                {entry.does.length} {entry.does.length === 1 ? "task" : "tasks"}
                {entry.leads.length > 0 ? `, leads ${entry.leads.length}` : ""}
                {entry.held.length > 0 ? `, holds for ${entry.held.length} ${entry.held.length === 1 ? "role" : "roles"}` : ""}
              </span>
            </summary>
            <div className="night-parts">
              {entry.does.length > 0 ? (
                <div>
                  <h3>Does</h3>
                  <TaskList tasks={entry.does} matrix={matrix} />
                </div>
              ) : null}
              {entry.leads.length > 0 ? (
                <div>
                  <h3>Leads</h3>
                  <TaskList tasks={entry.leads} matrix={matrix} />
                </div>
              ) : null}
              {entry.held.map((held) => (
                <div key={held.from.id}>
                  <h3>
                    Holds for the {held.from.href ? <Link href={held.from.href}>{held.from.name}</Link> : held.from.name} <span className="muted">until {stageName(held.from.existsFrom)}</span>
                  </h3>
                  <TaskList tasks={held.tasks} matrix={matrix} />
                </div>
              ))}
              {entry.href ? (
                <p className="station-role-link">
                  <Link href={entry.href}>The role&apos;s page</Link>
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
