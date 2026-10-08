"use client";

import { useActionState } from "react";
import type { EditRecord, Field, Option } from "@/lib/structure";
import { removeRecord, saveNeeds, saveRecord, type EditResult } from "./actions";

const untouched: EditResult = { ok: false, message: "" };

function Result({ result }: { result: EditResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

type SheetInfo = { key: string; one: string; needsAbout: string | null };

/**
 * One sheet of the fleet's structure: a way to add a record, then every record
 * with its own form. The fields come from the sheet's list in `lib/structure.ts`,
 * so this draws areas, roles, units, posts and qualifications alike.
 */
export function Editor({
  sheet,
  fields,
  records,
  qualifications,
}: {
  sheet: SheetInfo;
  fields: Field[];
  records: EditRecord[];
  qualifications: Option[];
}) {
  return (
    <>
      <details className="record record-new">
        <summary>Add {/^[aeiou]/.test(sheet.one) ? "an" : "a"} {sheet.one}</summary>
        <div className="record-body">
          <RecordForm sheet={sheet} fields={fields} record={null} />
        </div>
      </details>

      {records.length === 0 ? <p>There is nothing here yet.</p> : null}
      {records.map((record, index) => {
        // A heading wherever the group changes.
        const heading = record.group && record.group !== records[index - 1]?.group ? record.group : null;
        return (
          <div key={record.id}>
            {heading ? <h3 className="record-group">{heading}</h3> : null}
            <details className="record">
              <summary>
                <strong>{record.title}</strong>
                <span>{record.note}</span>
              </summary>
              <div className="record-body">
                <RecordForm sheet={sheet} fields={fields} record={record} />
                {sheet.needsAbout ? <NeedsForm sheet={sheet} record={record} qualifications={qualifications} /> : null}
                <RemoveForm sheet={sheet} record={record} />
              </div>
            </details>
          </div>
        );
      })}
    </>
  );
}

function RecordForm({ sheet, fields, record }: { sheet: SheetInfo; fields: Field[]; record: EditRecord | null }) {
  const [result, action, pending] = useActionState(saveRecord, untouched);
  const id = record?.id ?? "new";
  // After a save is turned down the form shows what was typed. Otherwise it shows the record.
  const held = (key: string) => result.values?.[key] ?? record?.values[key] ?? "";
  const shown = fields.filter((field) => !(field.onlyWhenNew && record));

  // The form is drawn afresh after each answer. A list keeps the choice it was
  // first drawn with when a form is reset, so without this it would show the
  // old choice after a save, or lose the new one after a refusal.
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="sheet" value={sheet.key} />
      <input type="hidden" name="id" value={record?.id ?? ""} />
      {shown.map((field) => {
        const name = `${id}-${field.key}`;
        const hint = field.hint ? (
          <p className="hint" id={`${name}-hint`}>
            {field.hint}
          </p>
        ) : null;
        const described = field.hint ? `${name}-hint` : undefined;

        if (field.kind === "yes-no") {
          return (
            <div className="field" key={field.key}>
              <label className="choice" htmlFor={name}>
                <input id={name} name={field.key} type="checkbox" defaultChecked={result.values ? result.values[field.key] === "on" : held(field.key) === "yes"} />
                <span>{field.label}</span>
              </label>
            </div>
          );
        }
        return (
          <div className="field" key={field.key}>
            <label htmlFor={name}>
              {field.label}
              {field.required ? null : <span className="optional"> (optional)</span>}
            </label>
            {hint}
            {field.kind === "long" || field.kind === "lines" ? (
              <textarea
                id={name}
                name={field.key}
                rows={field.kind === "long" ? field.rows : 4}
                maxLength={field.kind === "long" ? field.max : undefined}
                defaultValue={held(field.key)}
                required={field.required}
                aria-describedby={described}
                spellCheck={field.kind === "long"}
              />
            ) : field.kind === "choice" || field.kind === "record" ? (
              <select id={name} name={field.key} defaultValue={held(field.key)} required={field.required} aria-describedby={described}>
                {field.required && record ? null : <option value="">{field.required ? "Choose one" : "None"}</option>}
                {field.options
                  // A role cannot lead to itself, nor a unit sit under itself.
                  .filter((option) => !(record && option.value === record.id))
                  .map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            ) : field.kind === "number" ? (
              <input
                id={name}
                name={field.key}
                type="number"
                min={field.min}
                max={field.max}
                step={1}
                defaultValue={held(field.key) || (field.key === "sort_order" && !record ? "0" : "")}
                required={field.required}
                aria-describedby={described}
              />
            ) : (
              <input
                id={name}
                name={field.key}
                type="text"
                maxLength={field.kind === "text" ? field.max : 60}
                defaultValue={held(field.key)}
                required={field.required}
                autoComplete="off"
                autoCapitalize={field.kind === "slug" ? "none" : undefined}
                spellCheck={field.kind === "slug" ? false : undefined}
                aria-describedby={described}
              />
            )}
          </div>
        );
      })}
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : record ? "Save" : `Add the ${sheet.one}`}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

function NeedsForm({ sheet, record, qualifications }: { sheet: SheetInfo; record: EditRecord; qualifications: Option[] }) {
  const [result, action, pending] = useActionState(saveNeeds, untouched);
  return (
    <form action={action} className="record-needs">
      <input type="hidden" name="sheet" value={sheet.key} />
      <input type="hidden" name="id" value={record.id} />
      <fieldset>
        <legend>What it needs</legend>
        <p className="hint">{sheet.needsAbout}</p>
        {qualifications.length === 0 ? <p>There are no qualifications yet.</p> : null}
        <ul>
          {qualifications.map((qualification) => {
            const held = record.needs.find((need) => need.id === qualification.value);
            return (
              <li key={qualification.value}>
                <label>
                  <input type="checkbox" name="need" value={qualification.value} defaultChecked={Boolean(held)} />
                  <span>{qualification.label}</span>
                </label>
                <label>
                  <input type="checkbox" name="waived" value={qualification.value} defaultChecked={held?.waived === true} />
                  <span>
                    Let off while acting<span className="visually-hidden">: {qualification.label}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save what it needs"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

function RemoveForm({ sheet, record }: { sheet: SheetInfo; record: EditRecord }) {
  const [result, action, pending] = useActionState(removeRecord, untouched);
  return (
    <div className="record-remove">
      <details className="confirm">
        <summary className="button button-quiet">Remove this {sheet.one}</summary>
        <form action={action} className="confirm-body">
          <input type="hidden" name="sheet" value={sheet.key} />
          <input type="hidden" name="id" value={record.id} />
          <p>Remove {record.title}? It cannot be brought back, though the log keeps what it was.</p>
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Removing" : "Yes, remove it"}
          </button>
        </form>
      </details>
      <Result result={result} />
    </div>
  );
}
