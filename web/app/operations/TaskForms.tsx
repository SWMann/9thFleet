"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/Icon";
import { RichField } from "@/components/rich/RichField";
import { levelIcons, levelName, taskLevels, type TaskLevel } from "@/lib/tasks";
import { passTaskDown, removeUnitTask, saveUnitTask, type OpsResult } from "./actions";

const untouched: OpsResult = { ok: false, message: "" };

function Result({ result }: { result: OpsResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

/** A task's level, as a label with its picture. */
export function LevelChip({ level }: { level: TaskLevel }) {
  return (
    <span className={`chip level level-${level}`}>
      <Icon name={levelIcons[level]} size={16} />
      {levelName(level)}
    </span>
  );
}

const isLevel = (value: string | undefined): value is TaskLevel => taskLevels.some((level) => level.key === value);

/**
 * A unit's task: its words, its callsign and who reads it. With a task it
 * changes that one. Without, it gives a task to one of the units that has none.
 *
 * Under the levels it says, in words, who will read the task at the level chosen.
 */
export function TaskForm({
  id,
  task,
  units = [],
}: {
  id: string;
  /** The task to change. Left out, the form adds one. */
  task?: { id: string; unit: string; callsign: string; level: TaskLevel; body: string; reads: Record<TaskLevel, string> };
  /** The units that have no task yet, each with who would read one at each level. */
  units?: { id: string; label: string; reads: Record<TaskLevel, string> }[];
}) {
  const [result, action, pending] = useActionState(saveUnitTask, untouched);
  const held = (key: string, otherwise: string) => result.values?.[key] ?? otherwise;
  const heldLevel = result.values?.level;
  // A new task starts as the unit's own.
  const [level, setLevel] = useState<TaskLevel>(isLevel(heldLevel) ? heldLevel : (task?.level ?? "unit"));
  const [picked, setUnit] = useState(held("unit", units[0]?.id ?? ""));
  // Once a unit has its task it leaves the list, so what was picked may no longer be on it.
  const unit = units.some((entry) => entry.id === picked) ? picked : (units[0]?.id ?? "");
  const at = task?.id ?? "new";
  const reads = task ? task.reads : units.find((entry) => entry.id === unit)?.reads;

  return (
    <form action={action} className="fields task-form" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      {task ? <input type="hidden" name="task" value={task.id} /> : null}

      {task ? null : (
        <div className="field">
          <label htmlFor="task-new-unit">Unit</label>
          <select id="task-new-unit" name="unit" value={unit} onChange={(change) => setUnit(change.target.value)} required>
            {units.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor={`task-${at}-body`}>{task ? `Task for ${task.unit}` : "Task"}</label>
        <p className="hint" id={`task-${at}-body-hint`}>
          What the unit is to do, and in order to do what.
        </p>
        <RichField
          id={`task-${at}-body`}
          name="body"
          rows={4}
          maxLength={2000}
          required
          defaultValue={held("body", task?.body ?? "")}
          describedBy={`task-${at}-body-hint`}
        />
      </div>

      <div className="field">
        <label htmlFor={`task-${at}-callsign`}>
          Callsign <span className="optional">Optional</span>
        </label>
        <input id={`task-${at}-callsign`} name="callsign" type="text" maxLength={40} autoComplete="off" defaultValue={held("callsign", task?.callsign ?? "")} />
      </div>

      <fieldset className="levels">
        <legend>Who can read it</legend>
        <div className="levels-row">
          {taskLevels.map((entry) => (
            <label key={entry.key} className={entry.key === level ? "levels-on" : undefined}>
              <input type="radio" name="level" value={entry.key} checked={entry.key === level} onChange={() => setLevel(entry.key)} />
              <Icon name={levelIcons[entry.key]} size={16} />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
        <p className="levels-reads" aria-live="polite">
          <Icon name="eye" size={18} />
          <span>
            {reads ? reads[level] : "Choose the unit."} {level === "everyone" ? "" : "Everyone else is shown that it is withheld. Command and whoever runs the event always read it."}
          </span>
        </p>
      </fieldset>

      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : task ? "Save the task" : "Give the task"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

export function RemoveTask({ id, task, unit }: { id: string; task: string; unit: string }) {
  const [result, action, pending] = useActionState(removeUnitTask, untouched);
  return (
    <form action={action} className="record-remove">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="task" value={task} />
      <div className="form-end">
        <button className="link-button" type="submit" disabled={pending}>
          Remove this task
          <span className="visually-hidden">: {unit}</span>
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** For a unit's commander: open the task to the unit's leaders, or to the whole unit. */
export function PassDown({ id, task, unit, to }: { id: string; task: string; unit: string; to: TaskLevel[] }) {
  const [result, action, pending] = useActionState(passTaskDown, untouched);
  return (
    <form action={action} className="pass-down">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="task" value={task} />
      <span className="pass-down-label">Pass it down</span>
      {to.includes("leaders") ? (
        <button className="button button-quiet" type="submit" name="level" value="leaders" disabled={pending}>
          Open to my leaders
          <span className="visually-hidden">: {unit}</span>
        </button>
      ) : null}
      {to.includes("unit") ? (
        <button className="button button-quiet" type="submit" name="level" value="unit" disabled={pending}>
          Open to my unit
          <span className="visually-hidden">: {unit}</span>
        </button>
      ) : null}
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}
