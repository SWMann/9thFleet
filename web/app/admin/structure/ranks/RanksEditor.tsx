"use client";

import { useActionState } from "react";
import { saveGrade, type EditResult } from "../actions";

const untouched: EditResult = { ok: false, message: "" };

export type GradeRow = { code: string; typicalPosition: string; navy: string; army: string; marines: string };

/** One grade: what it usually does, and its rank name in each service. */
export function GradeForm({ grade }: { grade: GradeRow }) {
  const [result, action, pending] = useActionState(saveGrade, untouched);
  const field = (key: string, label: string, value: string, max: number) => (
    <div className="field">
      <label htmlFor={`${grade.code}-${key}`}>{label}</label>
      <input id={`${grade.code}-${key}`} name={key} type="text" defaultValue={value} maxLength={max} required autoComplete="off" />
    </div>
  );
  return (
    <details className="record">
      <summary>
        <strong className="grade">{grade.code}</strong>
        <span>
          {grade.navy} · {grade.army} · {grade.marines}
        </span>
      </summary>
      <div className="record-body">
        <form action={action} className="fields fields-wide">
          <input type="hidden" name="code" value={grade.code} />
          {field("typical_position", "What a member at this grade usually does", grade.typicalPosition, 80)}
          <div className="field-row">
            {field("navy", "Navy rank", grade.navy, 40)}
            {field("army", "Army rank", grade.army, 40)}
            {field("marines", "Marines rank", grade.marines, 40)}
          </div>
          <div className="form-end">
            <button className="button" type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </button>
            <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
              {result.message}
            </p>
          </div>
        </form>
      </div>
    </details>
  );
}
