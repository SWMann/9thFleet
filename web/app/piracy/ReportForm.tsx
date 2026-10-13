"use client";

import { useActionState } from "react";
import { REACHES_BACK } from "@/lib/piracy-form";
import { sendReport, type ReportResult } from "./actions";

const untouched: ReportResult = { ok: false, message: "" };

const suspects = [
  { value: "unknown", label: "I do not know" },
  { value: "individual", label: "A player" },
  { value: "organisation", label: "An organisation" },
];

/** The report form. A report that was not sent is given back as it was filled in. */
export function ReportForm() {
  const [result, action, pending] = useActionState(sendReport, untouched);
  const values = result.values ?? {};
  const suspect = suspects.some((entry) => entry.value === values.suspect_kind) ? values.suspect_kind : "unknown";

  return (
    <form action={action} className="fields fields-wide report-form" key={result.stamp ?? 0}>
      <div className="field">
        <label className="choice">
          <input type="checkbox" name="urgent" defaultChecked={values.urgent === "on"} />
          <span>
            It is happening now
            <small>Tick this if you are under attack, or being held, as you write.</small>
          </span>
        </label>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="report_handle">Your handle in the game</label>
          <p className="hint" id="report_handle_hint">
            Your RSI handle, so that the fleet can find you in the game. Not your real name.
          </p>
          <input
            id="report_handle"
            name="reporter_handle"
            type="text"
            defaultValue={values.reporter_handle ?? ""}
            required
            minLength={2}
            maxLength={60}
            pattern="[A-Za-z0-9_\-]{2,60}"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="report_handle_hint"
          />
        </div>
        <div className="field">
          <label htmlFor="report_day">
            The day it happened <span className="optional">Optional</span>
          </label>
          <p className="hint" id="report_day_hint">
            Leave it empty for today. The line takes reports from the last {REACHES_BACK} days.
          </p>
          <input id="report_day" name="happened_on" type="date" defaultValue={values.happened_on ?? ""} aria-describedby="report_day_hint" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="report_location">Where it happened</label>
        <p className="hint" id="report_location_hint">
          The system and the nearest place, such as Stanton, the ring at Yela.
        </p>
        <input
          id="report_location"
          name="location"
          type="text"
          defaultValue={values.location ?? ""}
          required
          minLength={2}
          maxLength={120}
          autoComplete="off"
          aria-describedby="report_location_hint"
        />
      </div>

      <fieldset className="field choices">
        <legend>Who did it?</legend>
        {suspects.map((entry) => (
          <label key={entry.value} className="choice">
            <input type="radio" name="suspect_kind" value={entry.value} defaultChecked={entry.value === suspect} />
            <span>{entry.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="report_suspect">
          Their handle or organisation ID <span className="optional">Optional</span>
        </label>
        <p className="hint" id="report_suspect_hint">
          As the game shows it, with no spaces. Leave it empty if you do not know who it was.
        </p>
        <input
          id="report_suspect"
          name="suspect_handle"
          type="text"
          defaultValue={values.suspect_handle ?? ""}
          maxLength={60}
          pattern="[A-Za-z0-9_\-]{2,60}"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="report_suspect_hint"
        />
      </div>

      <div className="field">
        <label htmlFor="report_details">What they did</label>
        <p className="hint" id="report_details_hint">
          What you saw in the game: the ships, what was said, what you lost. Nothing about anyone outside the game.
        </p>
        <textarea
          id="report_details"
          name="details"
          rows={6}
          required
          minLength={20}
          maxLength={2000}
          defaultValue={values.details ?? ""}
          aria-describedby="report_details_hint"
        />
      </div>

      <div className="field">
        <label htmlFor="report_evidence">
          Where to see it <span className="optional">Optional</span>
        </label>
        <p className="hint" id="report_evidence_hint">
          Web addresses of a screenshot or a clip, one to a line, each starting https://
        </p>
        <textarea
          id="report_evidence"
          name="evidence"
          rows={3}
          maxLength={1000}
          defaultValue={values.evidence ?? ""}
          spellCheck={false}
          aria-describedby="report_evidence_hint"
        />
      </div>

      {/* A field no person sees or reaches. A robot that fills in every field fills in this one, and its report is dropped. */}
      <div className="trap" aria-hidden="true">
        <label htmlFor="report_check">Leave this one empty</label>
        <input id="report_check" name="fleet_check" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Sending" : "Send the report"}
        </button>
        <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
          {result.message}
        </p>
      </div>
    </form>
  );
}
