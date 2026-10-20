import Link from "next/link";
import type { Matrix } from "@/lib/doctrine";
import { phaseName, type Task } from "@/lib/matrix";

/** Where a task belongs: its situation, its type, or every operation. */
export function taskHome(task: Task, matrix: Matrix): { name: string; href: string } {
  if (task.situationSlug) {
    return { name: matrix.situations.find((situation) => situation.slug === task.situationSlug)?.name ?? "A situation", href: `/operations/situations/${task.situationSlug}` };
  }
  if (task.typeKey) return { name: matrix.types.find((type) => type.key === task.typeKey)?.name ?? "A type", href: `/operations/types/${task.typeKey}` };
  return { name: "Every operation", href: "/operations/types" };
}

/** A compact list of tasks, each with where it belongs and its phase. */
export function TaskList({ tasks, matrix }: { tasks: Task[]; matrix: Matrix }) {
  return (
    <ul className="night-tasks">
      {tasks.map((task) => {
        const home = taskHome(task, matrix);
        return (
          <li key={task.id}>
            <span className="night-task">{task.wording}</span>
            <small>
              <Link href={home.href}>{home.name}</Link>
              {task.phase !== "drill" ? ` · ${phaseName(task.phase)}` : ""}
            </small>
          </li>
        );
      })}
    </ul>
  );
}
