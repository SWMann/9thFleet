"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  kinds,
  paragraphs,
  returnedNames,
  weapons,
  type EventKind,
  type Reply,
  type Returned,
  type WeaponsState,
} from "@/lib/operations-form";
import {
  createEvent,
  fileReport,
  fileReturn,
  moveEvent,
  replyToEvent,
  saveOrders,
  setStandIn,
  updateEvent,
  type OpsResult,
} from "./actions";

const untouched: OpsResult = { ok: false, message: "" };

type Named = { id: string; name: string; rankName: string | null };
const label = (person: Named) => (person.rankName ? `${person.rankName} ${person.name}` : person.name);

function Result({ result }: { result: OpsResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

export type EventFields = {
  id?: string;
  kind: EventKind;
  title: string;
  summary: string;
  date: string;
  time: string;
  duration: number;
  commander: string;
  second: string;
  observer: string;
  weaponsState: WeaponsState | "";
  pveFallback: string;
};

/** The details of an event: what it is, when, and who commands it. Used to draft one and to change one. */
export function EventForm({
  event,
  mayCreate,
  people,
}: {
  event: EventFields;
  mayCreate: EventKind[];
  people: Named[];
}) {
  const [result, action, pending] = useActionState(event.id ? updateEvent : createEvent, untouched);
  // Someone changing an event they did not draft keeps its type on the list.
  const offered = kinds.filter((kind) => mayCreate.includes(kind.key) || kind.key === event.kind);

  return (
    <form action={action} className="fields fields-wide">
      {event.id ? <input type="hidden" name="id" value={event.id} /> : null}

      <div className="field">
        <label htmlFor="kind">Type</label>
        <p className="hint" id="kind_hint">
          Command drafts any type. An instructor drafts training.
        </p>
        <select id="kind" name="kind" defaultValue={event.kind} required aria-describedby="kind_hint">
          {offered.map((kind) => (
            <option key={kind.key} value={kind.key}>
              {kind.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="title">Title</label>
        <p className="hint" id="title_hint">
          A short name, such as Patrol 001.
        </p>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={event.title}
          required
          minLength={3}
          maxLength={80}
          autoComplete="off"
          aria-describedby="title_hint"
        />
      </div>

      <div className="field">
        <label htmlFor="summary">
          Summary <span className="optional">Optional</span>
        </label>
        <p className="hint" id="summary_hint">
          One line on the task, such as the lane between ArcCorp and microTech. Members see it. Visitors never do.
        </p>
        <input
          id="summary"
          name="summary"
          type="text"
          defaultValue={event.summary}
          maxLength={200}
          autoComplete="off"
          aria-describedby="summary_hint"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={event.date} required />
        </div>
        <div className="field">
          <label htmlFor="time">Start, in UTC</label>
          <input id="time" name="time" type="time" defaultValue={event.time} required />
        </div>
        <div className="field">
          <label htmlFor="duration">Minutes</label>
          <input id="duration" name="duration" type="number" defaultValue={event.duration} min={15} max={480} step={5} required />
        </div>
      </div>
      <p className="field-note">
        Orders use UTC. A warning order goes out at least 72 hours before, and the roll closes 24 hours before.
      </p>

      <div className="field">
        <label htmlFor="commander">Operation commander</label>
        <p className="hint" id="commander_hint">
          They command everyone present, whatever rank anyone wears.
        </p>
        <select id="commander" name="commander" defaultValue={event.commander} required aria-describedby="commander_hint">
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {label(person)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="second">
          Second-in-command <span className="optional">Optional</span>
        </label>
        <p className="hint" id="second_hint">
          They take over at once if the commander drops out. Name one from whoever is attending if nobody is set yet.
        </p>
        <select id="second" name="second" defaultValue={event.second} aria-describedby="second_hint">
          <option value="">Not named yet</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {label(person)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="observer">
          Observer <span className="optional">Optional</span>
        </label>
        <p className="hint" id="observer_hint">
          An instructor who watches and debriefs on training and assessed operations. They give no orders.
        </p>
        <select id="observer" name="observer" defaultValue={event.observer} aria-describedby="observer_hint">
          <option value="">None</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {label(person)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="weapons_state">
          Weapons state <span className="optional">Optional</span>
        </label>
        <select id="weapons_state" name="weapons_state" defaultValue={event.weaponsState}>
          <option value="">Not set</option>
          {weapons.map((state) => (
            <option key={state.key} value={state.key}>
              {state.name}: {state.meaning.toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="pve_fallback">
          Fallback <span className="optional">Optional</span>
        </label>
        <p className="hint" id="pve_fallback_hint">
          What the force does if no hostile shows. Every operation against players carries one.
        </p>
        <input
          id="pve_fallback"
          name="pve_fallback"
          type="text"
          defaultValue={event.pveFallback}
          maxLength={200}
          autoComplete="off"
          aria-describedby="pve_fallback_hint"
        />
      </div>

      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : event.id ? "Save the details" : "Save as a draft"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** The warning order and the five paragraphs of the operation order. */
export function OrdersForm({ id, orders }: { id: string; orders: Record<string, string> }) {
  const [result, action, pending] = useActionState(saveOrders, untouched);
  return (
    <form action={action} className="fields fields-wide">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="warning_order">Warning order</label>
        <p className="hint" id="warning_order_hint">
          The task, the time, the commander and the second-in-command. It goes out at least 72 hours before.
        </p>
        <textarea
          id="warning_order"
          name="warning_order"
          rows={4}
          maxLength={4000}
          defaultValue={orders.warning_order}
          aria-describedby="warning_order_hint"
        />
      </div>
      {paragraphs.map((paragraph) => (
        <div className="field" key={paragraph.key}>
          <label htmlFor={paragraph.key}>{paragraph.name}</label>
          <p className="hint" id={`${paragraph.key}_hint`}>
            {paragraph.holds}
          </p>
          <textarea
            id={paragraph.key}
            name={paragraph.key}
            rows={paragraph.key === "mission" ? 2 : 4}
            maxLength={paragraph.max}
            defaultValue={orders[paragraph.key]}
            aria-describedby={`${paragraph.key}_hint`}
          />
        </div>
      ))}
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the orders"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** The two answers a member can give, with the one they have given marked. */
export function ReplyForm({ id, reply }: { id: string; reply: Reply | null }) {
  const [result, action, pending] = useActionState(replyToEvent, untouched);
  return (
    <form action={action} className="reply">
      <input type="hidden" name="id" value={id} />
      <button
        className={reply === "attending" ? "button" : "button button-quiet"}
        type="submit"
        name="reply"
        value="attending"
        aria-pressed={reply === "attending"}
        disabled={pending}
      >
        Attending
      </button>
      <button
        className={reply === "not_attending" ? "button" : "button button-quiet"}
        type="submit"
        name="reply"
        value="not_attending"
        aria-pressed={reply === "not_attending"}
        disabled={pending}
      >
        Not attending
      </button>
      <Result result={result} />
    </form>
  );
}

/**
 * What whoever runs an event can do to it: change it, announce a draft, or
 * cancel it. Announcing and cancelling each ask once more, because the fleet is told.
 */
export function MoveForms({
  id,
  state,
  title,
  editHref,
  mayCancel,
}: {
  id: string;
  state: "draft" | "announced";
  title: string;
  /** The page for changing the details and orders, for someone who may. */
  editHref: string | null;
  mayCancel: boolean;
}) {
  const [result, action, pending] = useActionState(moveEvent, untouched);
  return (
    <div className="decisions">
      {editHref ? (
        <Link className="button button-quiet" href={editHref}>
          Change the details and orders
        </Link>
      ) : null}
      {state === "draft" ? (
        <details className="confirm">
          <summary className="button">Announce</summary>
          <form action={action} className="confirm-body">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="state" value="announced" />
            <p>Announce {title}? Every serving member will see it and can reply. It can be cancelled, but not hidden again.</p>
            <button className="button" type="submit" disabled={pending}>
              Yes, announce it
            </button>
          </form>
        </details>
      ) : null}
      {mayCancel ? (
        <details className="confirm">
          <summary className="button button-quiet">Cancel the event</summary>
          <form action={action} className="confirm-body">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="state" value="cancelled" />
            <p>Cancel {title}? It stays on the record as cancelled and cannot be reopened.</p>
            <button className="button" type="submit" disabled={pending}>
              Yes, cancel it
            </button>
          </form>
        </details>
      ) : null}
      <Result result={result} />
    </div>
  );
}

/** One button: stand in for a post, or step back out of it. */
export function StandInButton({ id, position, children }: { id: string; position: string; children: string }) {
  const [result, action, pending] = useActionState(setStandIn, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value={position} />
      <button className="button button-small" type="submit" disabled={pending}>
        {children}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** For whoever runs the event: put an attending member into a post for the night. */
export function PlaceForm({
  id,
  position,
  post,
  spare,
  inPost,
}: {
  id: string;
  position: string;
  post: string;
  spare: Named[];
  /** Members attending in their own post. Moving one up leaves that post to fill. */
  inPost: Named[];
}) {
  const [result, action, pending] = useActionState(setStandIn, untouched);
  const field = `member_${position}`;
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value={position} />
      <label className="visually-hidden" htmlFor={field}>
        Stand-in for {post}
      </label>
      <select id={field} name="member" defaultValue="" required>
        <option value="" disabled>
          Choose a stand-in
        </option>
        {spare.length > 0 ? (
          <optgroup label="No post tonight">
            {spare.map((person) => (
              <option key={person.id} value={person.id}>
                {label(person)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {inPost.length > 0 ? (
          <optgroup label="Move up from their own post">
            {inPost.map((person) => (
              <option key={person.id} value={person.id}>
                {label(person)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <button className="button button-small" type="submit" disabled={pending}>
        Place
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** For whoever runs the event: take a stand-in back out of a post. */
export function RemoveStandIn({ id, member, name }: { id: string; member: string; name: string }) {
  const [result, action, pending] = useActionState(setStandIn, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value="" />
      <input type="hidden" name="member" value={member} />
      <button className="link-button" type="submit" disabled={pending}>
        Remove<span className="visually-hidden"> {name} from this post</span>
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** The attendance return: everyone on the roll, marked present or absent. */
export function ReturnForm({
  id,
  lines,
  done,
}: {
  id: string;
  lines: { person: Named; reply: Reply | null; returned: Returned | null }[];
  done: boolean;
}) {
  const [result, action, pending] = useActionState(fileReturn, untouched);
  // Until it is made, the return starts from what each member said they would do.
  const suggested = (line: { reply: Reply | null; returned: Returned | null }): Returned =>
    line.returned ?? (line.reply === "attending" ? "present" : line.reply === "not_attending" ? "absent_with_notice" : "absent_without_notice");

  return (
    <form action={action} className="return">
      <input type="hidden" name="id" value={id} />
      <ul className="return-lines">
        {lines.map((line) => (
          <li key={line.person.id}>
            <label htmlFor={`returned_${line.person.id}`}>
              {label(line.person)}
              <span className="aside">
                {line.reply === "attending" ? "Said attending" : line.reply === "not_attending" ? "Said not attending" : "Did not reply"}
              </span>
            </label>
            <select id={`returned_${line.person.id}`} name={`returned:${line.person.id}`} defaultValue={suggested(line)}>
              {(Object.keys(returnedNames) as Returned[]).map((value) => (
                <option key={value} value={value}>
                  {returnedNames[value]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : done ? "Correct the return" : "Make the return and close the event"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** The after-action report, under the hot debrief's own headings. */
export function ReportForm({
  id,
  report,
}: {
  id: string;
  report: { whatHappened: string; toKeep: string; toChange: string } | null;
}) {
  const [result, action, pending] = useActionState(fileReport, untouched);
  return (
    <form action={action} className="fields fields-wide">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="what_happened">What happened</label>
        <p className="hint" id="what_happened_hint">
          The plan, what happened and why.
        </p>
        <textarea
          id="what_happened"
          name="what_happened"
          rows={6}
          maxLength={6000}
          required
          defaultValue={report?.whatHappened ?? ""}
          aria-describedby="what_happened_hint"
        />
      </div>
      <div className="field">
        <label htmlFor="to_keep">
          What to keep <span className="optional">Optional</span>
        </label>
        <textarea id="to_keep" name="to_keep" rows={4} maxLength={4000} defaultValue={report?.toKeep ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="to_change">
          What to change <span className="optional">Optional</span>
        </label>
        <textarea id="to_change" name="to_change" rows={4} maxLength={4000} defaultValue={report?.toChange ?? ""} />
      </div>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : report ? "Correct the report" : "File the report"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}
