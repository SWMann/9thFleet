"use client";

import { useActionState } from "react";
import { closeReport, deleteReport, reopenReport, type ReportToolResult } from "./actions";

const untouched: ReportToolResult = { ok: false, message: "" };

function Result({ result }: { result: ReportToolResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

/** Close a report that waits: mark it handled, or dismiss it. Either takes a word of what came of it. */
export function CloseForms({ id, from }: { id: string; from: string }) {
  const [result, action, pending] = useActionState(closeReport, untouched);
  const close = (decision: "handled" | "dismissed", label: string, ask: string, yes: string) => (
    <details className="confirm">
      <summary className="button button-quiet">{label}</summary>
      <form action={action} className="confirm-body">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value={decision} />
        <p>{ask}</p>
        <div className="field">
          <label htmlFor={`close_${decision}_${id}`}>
            What came of it <span className="optional">Optional</span>
          </label>
          <input id={`close_${decision}_${id}`} name="note" type="text" maxLength={500} autoComplete="off" />
        </div>
        <button className="button" type="submit" disabled={pending}>
          {yes}
        </button>
      </form>
    </details>
  );
  return (
    <>
      {close("handled", "Mark as handled", `Mark the report from ${from} as handled? It moves to the handled reports.`, "Yes, it is handled")}
      {close("dismissed", "Dismiss", `Dismiss the report from ${from}? Use this for a report the fleet will not act on.`, "Yes, dismiss it")}
      <Result result={result} />
    </>
  );
}

/** Put a closed report back among those that wait. */
export function ReopenForm({ id }: { id: string }) {
  const [result, action, pending] = useActionState(reopenReport, untouched);
  return (
    <>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button className="button button-quiet" type="submit" disabled={pending}>
          Reopen
        </button>
      </form>
      <Result result={result} />
    </>
  );
}

/** Delete a report for good. */
export function DeleteForm({ id, from }: { id: string; from: string }) {
  const [result, action, pending] = useActionState(deleteReport, untouched);
  return (
    <>
      <details className="confirm">
        <summary className="button button-quiet">Delete</summary>
        <form action={action} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <p>
            Delete the report from {from}? Its words are removed for good, here and in the log of changes. An entry on the hostile list
            that was started from it stays.
          </p>
          <button className="button" type="submit" disabled={pending}>
            Yes, delete it
          </button>
        </form>
      </details>
      <Result result={result} />
    </>
  );
}
