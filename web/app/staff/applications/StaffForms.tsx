"use client";

import { useActionState } from "react";
import { addNote, moveApplication, type StaffResult } from "./actions";

const untouched: StaffResult = { ok: false, message: "" };

function Result({ result }: { result: StaffResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

/**
 * The steps staff can take on an open application. Accepting and declining
 * cannot be undone, so each asks once more before it is sent.
 */
export function DecisionForms({
  id,
  stage,
  name,
  service,
}: {
  id: string;
  stage: "submitted" | "interview";
  name: string;
  service: string;
}) {
  const [result, action, pending] = useActionState(moveApplication, untouched);

  return (
    <div className="decisions">
      {stage === "submitted" ? (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="stage" value="interview" />
          <button className="button" type="submit" disabled={pending}>
            Move to interview
          </button>
        </form>
      ) : null}

      <details className="confirm">
        <summary className={stage === "interview" ? "button" : "button button-quiet"}>Accept</summary>
        <form action={action} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="stage" value="accepted" />
          <p>
            Accept {name}? They become a recruit in the {service}. This cannot be undone here.
          </p>
          <button className="button" type="submit" disabled={pending}>
            Yes, accept
          </button>
        </form>
      </details>

      <details className="confirm">
        <summary className="button button-quiet">Decline</summary>
        <form action={action} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="stage" value="declined" />
          <p>Decline {name}? The application closes and cannot be reopened. They may apply again.</p>
          <button className="button" type="submit" disabled={pending}>
            Yes, decline
          </button>
        </form>
      </details>

      <Result result={result} />
    </div>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [result, action, pending] = useActionState(addNote, untouched);

  return (
    <form action={action} className="fields fields-wide">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="note">Add a note</label>
        <p className="hint" id="note_hint">
          What was said at interview, and what you think. Staff can read it. The applicant cannot.
        </p>
        <textarea id="note" name="body" rows={4} maxLength={4000} required aria-describedby="note_hint" />
      </div>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save note"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}
