"use client";

import { useActionState } from "react";
import { renewDuty, type DutyResult } from "./actions";

const untouched: DutyResult = { ok: false, message: "" };

/** Command renews a duty the member holds, for another three months from today. */
export function RenewDutyForm({ assignment, title }: { assignment: string; title: string }) {
  const [result, action, pending] = useActionState(renewDuty, untouched);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="assignment" value={assignment} />
      <button className="button button-quiet button-small" type="submit" disabled={pending}>
        {pending ? "Renewing" : "Renew for three months"}
        <span className="visually-hidden">: {title}</span>
      </button>
      {result.message ? (
        <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
