import Link from "next/link";
import { Scroll } from "@/components/admin/Charts";
import type { Matrix } from "@/lib/doctrine";
import { byPhase, holderAt, stageName, taskStage, tokenWords, type ChainRole, type Party, type Task } from "@/lib/matrix";

/**
 * Who holds a role's tasks at the fleet's stage: the role itself, or the
 * role down its chain that holds them until it exists. Linked to the role's
 * page where it has one.
 */
export function Who({ roleId, matrix, people }: { roleId: string | null; matrix: Matrix; people?: (roleId: string) => string[] }) {
  if (!roleId) return <span className="muted">Nobody</span>;
  const asked = matrix.roles.get(roleId);
  if (!asked) return <span className="muted">A role that is gone</span>;
  const held = holderAt(matrix.roles, roleId, matrix.stage);
  const role = held?.role ?? asked;
  const names = people?.(role.id) ?? [];
  return (
    <span className="who">
      {names.length > 0 ? <strong className="who-people">{names.join(", ")}</strong> : null}
      <RoleName role={role} />
      {held && held.role.id !== asked.id ? <small>for the {asked.name}</small> : null}
      {!held ? <small>nobody until {stageName(asked.existsFrom)}</small> : null}
    </span>
  );
}

export const RoleName = ({ role }: { role: ChainRole }) => (role.href ? <Link href={role.href}>{role.name}</Link> : <span>{role.name}</span>);

function Parties({ parties, matrix, people }: { parties: Party[]; matrix: Matrix; people?: (roleId: string) => string[] }) {
  if (parties.length === 0) return <span className="muted">Nobody</span>;
  return (
    <span className="parties">
      {parties.map((party, index) =>
        party.kind === "token" ? (
          <span key={party.token}>{tokenWords(party.token)}</span>
        ) : (
          <Who key={`${party.roleId}-${index}`} roleId={party.roleId} matrix={matrix} people={people} />
        ),
      )}
    </span>
  );
}

const typeOpens = (matrix: Matrix) => (key: string) => matrix.types.find((type) => type.key === key)?.opensAt ?? 1;

/**
 * Tasks by phase, each with who does it, who leads it, who supervises, and
 * who is consulted and informed, every post resolved to the role that holds
 * it at the fleet's stage. With `people`, each role carries the names of
 * those who hold it on the night.
 */
export function TaskTable({ tasks, matrix, label, people, phases = true }: { tasks: Task[]; matrix: Matrix; label: string; people?: (roleId: string) => string[]; phases?: boolean }) {
  const opens = typeOpens(matrix);
  const groups = phases ? byPhase(tasks) : [{ phase: "drill" as const, name: "", tasks }];
  if (tasks.length === 0) return <p className="intro">No tasks yet.</p>;
  return (
    <>
      {groups.map((group) => (
        <div className="task-phase" key={group.phase}>
          {group.name ? <h3>{group.name}</h3> : null}
          <Scroll label={`${label}: ${group.name || "the drill"}`}>
            <table className="data data-tasks">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Does</th>
                  <th scope="col">Leads</th>
                  <th scope="col">Supervised by</th>
                  <th scope="col">Consulted</th>
                  <th scope="col">Informed</th>
                </tr>
              </thead>
              <tbody>
                {group.tasks.map((task) => {
                  const from = taskStage(task, opens);
                  const later = from > matrix.stage;
                  return (
                    <tr key={task.id} className={later ? "task-later" : undefined}>
                      <th scope="row">
                        {task.wording}
                        <small>
                          {task.echelon}
                          {later ? ` · from ${stageName(from)}` : ""}
                          {task.notes ? ` · ${task.notes}` : ""}
                        </small>
                      </th>
                      <td>
                        <Who roleId={task.doesId} matrix={matrix} people={people} />
                      </td>
                      <td>
                        <Who roleId={task.leadsId} matrix={matrix} people={people} />
                      </td>
                      <td>
                        {task.supervisesCommandId || task.supervisesTechnicalId ? (
                          <span className="parties">
                            {task.supervisesCommandId ? <Who roleId={task.supervisesCommandId} matrix={matrix} people={people} /> : null}
                            {task.supervisesTechnicalId ? (
                              <span className="who">
                                <Who roleId={task.supervisesTechnicalId} matrix={matrix} people={people} />
                                <small>for the standard</small>
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="muted">Nobody</span>
                        )}
                      </td>
                      <td>
                        <Parties parties={task.consulted} matrix={matrix} people={people} />
                      </td>
                      <td>
                        <Parties parties={task.informed} matrix={matrix} people={people} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Scroll>
        </div>
      ))}
    </>
  );
}
