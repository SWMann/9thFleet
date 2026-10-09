"use client";

import Link from "next/link";
import { useActionState } from "react";
import { RichField } from "@/components/rich/RichField";
import { confirmations, questions, serviceNames } from "@/lib/application-form";
import { submitApplication, type ApplyResult } from "./actions";

const untouched: ApplyResult = { ok: false, message: "" };

export function ApplicationForm({ services }: { services: (keyof typeof serviceNames)[] }) {
  const [result, action, pending] = useActionState(submitApplication, untouched);

  return (
    // An application that was not sent is given back as it was filled in.
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      {services.length === 1 ? (
        <div className="field">
          <span className="field-label">Service</span>
          <p className="hint">The {serviceNames[services[0]]} is the only service open at the moment.</p>
          <input type="hidden" name="service" value={services[0]} />
        </div>
      ) : (
        <fieldset className="field choices">
          <legend>Which service do you want to join?</legend>
          {services.map((service, index) => (
            <label key={service} className="choice">
              <input type="radio" name="service" value={service} defaultChecked={result.values?.service ? result.values.service === service : index === 0} required />
              <span>{serviceNames[service]}</span>
            </label>
          ))}
        </fieldset>
      )}

      {questions.map((question) => (
        <div className="field" key={question.id}>
          <label htmlFor={question.id}>
            {question.label}
            {question.required ? null : <span className="optional"> Optional</span>}
          </label>
          <p className="hint" id={`${question.id}_hint`}>
            {question.hint}
          </p>
          <RichField
            id={question.id}
            name={question.id}
            rows={question.rows}
            maxLength={question.max}
            required={question.required}
            defaultValue={result.values?.[question.id] ?? ""}
            describedBy={`${question.id}_hint`}
          />
        </div>
      ))}

      <fieldset className="field choices">
        <legend>Confirm each of these</legend>
        {confirmations.map((confirmation) => (
          <label key={confirmation.id} className="choice">
            <input type="checkbox" name={confirmation.id} defaultChecked={result.values?.[confirmation.id] === "on"} required />
            <span>
              {confirmation.statement}
              {confirmation.id === "standards" ? (
                <>
                  {" "}
                  <Link href="/standards" target="_blank">
                    Read the standards
                  </Link>
                </>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Sending" : "Send application"}
        </button>
        <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
          {result.message}
        </p>
      </div>
    </form>
  );
}
