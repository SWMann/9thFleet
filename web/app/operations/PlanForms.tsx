"use client";

import { useActionState } from "react";
import { outcomeNames, planPartOf, type Outcome, type PlanField, type PlanPartKey } from "@/lib/operations-form";
import {
  acknowledgeAmendment,
  issueAmendment,
  removePlanRow,
  saveOutcomes,
  savePlanRow,
  saveReading,
  signOff,
  type OpsResult,
} from "./actions";

const untouched: OpsResult = { ok: false, message: "" };

function Result({ result }: { result: OpsResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

/** One record of a plan's list, as the editor is given it. Every value is text, as a form holds it. */
export type PlanRow = { id: string; values: Record<string, string> };

export type Choice = { value: string; label: string };

/**
 * One of an event's lists: objectives, elements and tasks, the timeline, ships
 * or nets in its plan, and losses or mentions in its report. A way to add a
 * record, then every record with its own form. The fields come from
 * `planParts` in `lib/operations-form.ts`.
 */
export function PlanEditor({
  id,
  part,
  rows,
  members = [],
}: {
  id: string;
  part: PlanPartKey;
  rows: PlanRow[];
  /** Who can be chosen, for a list with a member in it. */
  members?: Choice[];
}) {
  const spec = planPartOf(part);
  if (!spec) return null;
  const article = /^[aeiou]/.test(spec.one) ? "an" : "a";
  return (
    <div className="plan-part" id={`plan-${spec.key}`}>
      <h3 className="plan-part-title">{spec.many}</h3>
      <p className="hint">{spec.about}</p>
      {rows.map((row) => {
        const note = spec.fields
          .filter((field) => field.key !== spec.titled && (field.kind === "text" || field.kind === "time" || field.kind === "number"))
          .map((field) => (field.kind === "number" && row.values[field.key] === "1" ? "" : row.values[field.key]))
          .filter(Boolean);
        return (
          <details className="record" key={row.id}>
            <summary>
              <strong>{row.values[spec.titled]}</strong>
              <span>{note.join(" · ")}</span>
            </summary>
            <div className="record-body">
              <RowForm id={id} part={spec.key} one={spec.one} fields={spec.fields} row={row} members={members} />
              <RemoveRow id={id} part={spec.key} one={spec.one} row={row} title={row.values[spec.titled]} />
            </div>
          </details>
        );
      })}
      <details className="record record-new">
        <summary>
          Add {article} {spec.one}
        </summary>
        <div className="record-body">
          <RowForm id={id} part={spec.key} one={spec.one} fields={spec.fields} row={null} members={members} />
        </div>
      </details>
    </div>
  );
}

function RowForm({
  id,
  part,
  one,
  fields,
  row,
  members,
}: {
  id: string;
  part: PlanPartKey;
  one: string;
  fields: PlanField[];
  row: PlanRow | null;
  members: Choice[];
}) {
  const [result, action, pending] = useActionState(savePlanRow, untouched);
  // After a save is turned down the form shows what was typed. A form that added a record empties itself.
  const held = (key: string) => result.values?.[key] ?? row?.values[key] ?? "";
  const at = row?.id ?? "new";
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="part" value={part} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="row" value={row?.id ?? ""} />
      {fields.map((field) => {
        const name = `${part}-${at}-${field.key}`;
        const described = field.hint ? `${name}-hint` : undefined;
        // Who a record is about is chosen when it is added. Afterwards it heads the record and is not a field.
        if (field.kind === "member" && row) return null;
        if (field.kind === "member") {
          return (
            <div className="field" key={field.key}>
              <label htmlFor={name}>{field.label}</label>
              <select id={name} name={field.key} defaultValue={held(field.key)} required>
                <option value="" disabled>
                  Choose a member
                </option>
                {members.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <div className="field" key={field.key}>
            <label htmlFor={name}>
              {field.label}
              {field.required ? null : <span className="optional"> Optional</span>}
            </label>
            {field.hint ? (
              <p className="hint" id={`${name}-hint`}>
                {field.hint}
              </p>
            ) : null}
            {field.kind === "long" ? (
              <textarea id={name} name={field.key} rows={4} maxLength={field.max} defaultValue={held(field.key)} required={field.required} aria-describedby={described} />
            ) : (
              <input
                id={name}
                name={field.key}
                type={field.kind === "time" ? "time" : field.kind === "number" ? "number" : "text"}
                maxLength={field.kind === "text" ? field.max : undefined}
                min={field.kind === "number" ? 1 : undefined}
                max={field.kind === "number" ? field.max : undefined}
                step={field.kind === "number" ? 1 : undefined}
                defaultValue={held(field.key) || (field.kind === "number" && !row ? "1" : "")}
                required={field.required}
                autoComplete="off"
                aria-describedby={described}
              />
            )}
          </div>
        );
      })}
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : row ? "Save" : `Add the ${one}`}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

function RemoveRow({ id, part, one, row, title }: { id: string; part: PlanPartKey; one: string; row: PlanRow; title: string }) {
  const [result, action, pending] = useActionState(removePlanRow, untouched);
  return (
    <form action={action} className="record-remove">
      <input type="hidden" name="part" value={part} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="row" value={row.id} />
      <div className="form-end">
        <button className="link-button" type="submit" disabled={pending}>
          Remove this {one}
          <span className="visually-hidden">: {title}</span>
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** What to read before the night: sections of the fleet manual, one to a line. */
export function ReadingForm({ id, reading }: { id: string; reading: string[] }) {
  const [result, action, pending] = useActionState(saveReading, untouched);
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="reading">
          Read before the night <span className="optional">Optional</span>
        </label>
        <p className="hint" id="reading_hint">
          Sections of the fleet manual, one to a line, as volume/section: command/orders. A section&apos;s address on
          the site can be pasted as it is.
        </p>
        <textarea
          id="reading"
          name="reading"
          rows={3}
          defaultValue={result.values?.reading ?? reading.join("\n")}
          spellCheck={false}
          autoCapitalize="none"
          aria-describedby="reading_hint"
        />
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the reading"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** For whoever runs an announced event: tell everyone attending what has changed. */
export function AmendmentForm({ id }: { id: string }) {
  const [result, action, pending] = useActionState(issueAmendment, untouched);
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="amendment">Issue an amendment</label>
        <p className="hint" id="amendment_hint">
          Say what has changed in the orders since they went out. It is numbered and dated, it cannot be rewritten, and
          everyone attending is asked to acknowledge it.
        </p>
        <textarea
          id="amendment"
          name="body"
          rows={3}
          maxLength={2000}
          required
          defaultValue={result.values?.body ?? ""}
          aria-describedby="amendment_hint"
        />
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Issuing" : "Issue the amendment"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** For a member who is attending: say they have read the latest amendment. */
export function AcknowledgeButton({ id, number }: { id: string; number: number }) {
  const [result, action, pending] = useActionState(acknowledgeAmendment, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="number" value={number} />
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Saving" : `Acknowledge amendment ${number}`}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

type Named = { id: string; name: string; rankName: string | null };
const rankAndName = (person: Named) => (person.rankName ? `${person.rankName} ${person.name}` : person.name);

/**
 * For an instructor, at an event that teaches a qualification: tick who
 * passed. Each pass is an award in the instructor's own name.
 */
export function SignOffForm({
  id,
  qualification,
  candidates,
}: {
  id: string;
  qualification: string;
  candidates: { person: Named; holds: boolean }[];
}) {
  const [result, action, pending] = useActionState(signOff, untouched);
  const open = candidates.filter((candidate) => !candidate.holds);
  return (
    <form action={action} className="picks" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend>Who passed</legend>
        <p className="hint">
          Tick everyone who met the standard for {qualification}. Each pass is signed in your name and dated today, and
          it is not undone from here.
        </p>
        <ul>
          {candidates.map((candidate) => (
            <li key={candidate.person.id}>
              <label>
                <input type="checkbox" name="pass" value={candidate.person.id} disabled={candidate.holds} defaultChecked={candidate.holds} />
                <span>
                  {rankAndName(candidate.person)}
                  {candidate.holds ? <small> Holds it already</small> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending || open.length === 0}>
          {pending ? "Signing off" : "Sign off the passes"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** For whoever ran the event: how each objective turned out. */
export function OutcomesForm({
  id,
  objectives,
  outcomes,
}: {
  id: string;
  objectives: { id: string; title: string }[];
  outcomes: Record<string, { outcome: Outcome; note: string }>;
}) {
  const [result, action, pending] = useActionState(saveOutcomes, untouched);
  return (
    <form action={action} className="outcomes" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <ol>
        {objectives.map((objective) => (
          <li key={objective.id}>
            <p className="outcomes-title">{objective.title}</p>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`outcome_${objective.id}`}>Outcome</label>
                <select id={`outcome_${objective.id}`} name={`outcome:${objective.id}`} defaultValue={outcomes[objective.id]?.outcome ?? ""}>
                  <option value="">Not answered yet</option>
                  {(Object.keys(outcomeNames) as Outcome[]).map((value) => (
                    <option key={value} value={value}>
                      {outcomeNames[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`note_${objective.id}`}>
                  Note <span className="optional">Optional</span>
                </label>
                <input
                  id={`note_${objective.id}`}
                  name={`note:${objective.id}`}
                  type="text"
                  maxLength={300}
                  defaultValue={outcomes[objective.id]?.note ?? ""}
                  autoComplete="off"
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the outcomes"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}
