"use client";

import { useActionState } from "react";
import { planPartOf, type PlanField, type PlanPartKey } from "@/lib/operations-form";
import { acknowledgeAmendment, issueAmendment, removePlanRow, savePlanRow, saveReading, type OpsResult } from "./actions";

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

/**
 * One list of an event's plan: objectives, elements and tasks, the timeline,
 * ships or nets. A way to add a record, then every record with its own form.
 * The fields come from `planParts` in `lib/operations-form.ts`.
 */
export function PlanEditor({ id, part, rows }: { id: string; part: PlanPartKey; rows: PlanRow[] }) {
  const spec = planPartOf(part);
  if (!spec) return null;
  const article = /^[aeiou]/.test(spec.one) ? "an" : "a";
  return (
    <div className="plan-part" id={`plan-${spec.key}`}>
      <h3 className="plan-part-title">{spec.many}</h3>
      <p className="hint">{spec.about}</p>
      {rows.map((row) => {
        const note = spec.fields.filter((field) => field.key !== spec.titled && field.kind !== "long").map((field) => row.values[field.key]).filter(Boolean);
        return (
          <details className="record" key={row.id}>
            <summary>
              <strong>{row.values[spec.titled]}</strong>
              <span>{note.join(" · ")}</span>
            </summary>
            <div className="record-body">
              <RowForm id={id} part={spec.key} one={spec.one} fields={spec.fields} row={row} />
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
          <RowForm id={id} part={spec.key} one={spec.one} fields={spec.fields} row={null} />
        </div>
      </details>
    </div>
  );
}

function RowForm({ id, part, one, fields, row }: { id: string; part: PlanPartKey; one: string; fields: PlanField[]; row: PlanRow | null }) {
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
                type={field.kind === "time" ? "time" : "text"}
                maxLength={field.kind === "time" ? undefined : field.max}
                defaultValue={held(field.key)}
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
