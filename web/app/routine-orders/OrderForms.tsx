"use client";

import { useActionState } from "react";
import { RichField } from "@/components/rich/RichField";
import { BODY_LIMIT } from "@/lib/orders-form";
import { discardDraft, draftOrders, issueOrders, markOrdersRead, saveOrders, type OrdersResult } from "./actions";

const untouched: OrdersResult = { ok: false, message: "" };

function Result({ result }: { result: OrdersResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

/** Command opens the next draft. The site writes the record of the period into it. */
export function DraftButton() {
  const [result, action, pending] = useActionState(draftOrders, untouched);
  return (
    <form action={action} className="decisions">
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Drafting" : "Draft the next issue"}
      </button>
      <Result result={result} />
    </form>
  );
}

/** The title and words of an issue: the draft, or an issued order being corrected. */
export function OrdersEditor({ id, title, body, issued }: { id: string; title: string; body: string; issued: boolean }) {
  const [result, action, pending] = useActionState(saveOrders, untouched);
  const values = result.values ?? { title, body };
  return (
    <form action={action} className="fields fields-wide orders-form" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor={`orders_title_${id}`}>
          Title <span className="optional">Optional</span>
        </label>
        <p className="hint" id={`orders_title_hint_${id}`}>
          A few words for the list, such as the week or what the issue is about. The number and the date are the site&apos;s.
        </p>
        <input id={`orders_title_${id}`} name="title" type="text" defaultValue={values.title ?? ""} maxLength={80} autoComplete="off" aria-describedby={`orders_title_hint_${id}`} />
      </div>
      <div className="field">
        <label htmlFor={`orders_body_${id}`}>The orders</label>
        <p className="hint" id={`orders_body_hint_${id}`}>
          {issued
            ? "Correct the words here. The number, the date and the period stay as they were issued."
            : "The site has written the record of the period. Add your own words, change what you need to, and delete what is not wanted."}
        </p>
        <RichField id={`orders_body_${id}`} name="body" rows={24} maxLength={BODY_LIMIT} defaultValue={values.body ?? ""} describedBy={`orders_body_hint_${id}`} />
      </div>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : issued ? "Save the correction" : "Save the draft"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Issue the draft, or discard it. Each asks first. */
export function DraftDecisions({ id }: { id: string }) {
  const [issued, issue, issuing] = useActionState(issueOrders, untouched);
  const [discarded, discard, discarding] = useActionState(discardDraft, untouched);
  return (
    <div className="decisions">
      <details className="confirm">
        <summary className="button">Issue it</summary>
        <form action={issue} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <p>Issue these orders to the fleet? Save the draft first if you have changed it. Once issued, the number and the date stand; the words can still be corrected.</p>
          <button className="button" type="submit" disabled={issuing}>
            Yes, issue it
          </button>
        </form>
      </details>
      <details className="confirm">
        <summary className="button button-quiet">Discard the draft</summary>
        <form action={discard} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <p>Discard this draft? The next draft starts afresh from the record.</p>
          <button className="button" type="submit" disabled={discarding}>
            Yes, discard it
          </button>
        </form>
      </details>
      {[issued, discarded].filter((result) => result.message !== "").map((result, index) => (
        <Result result={result} key={index} />
      ))}
    </div>
  );
}

/** A member marks an issue as read. */
export function MarkReadForm({ id }: { id: string }) {
  const [result, action, pending] = useActionState(markOrdersRead, untouched);
  return (
    <form action={action} className="decisions">
      <input type="hidden" name="id" value={id} />
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Marking" : "Mark as read"}
      </button>
      <Result result={result} />
    </form>
  );
}
