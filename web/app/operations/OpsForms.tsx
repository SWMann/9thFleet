"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  returnedNames,
  weapons,
  type EventType,
  type Reply,
  type Returned,
  type Section,
  type WeaponsState,
} from "@/lib/operations-form";
import {
  copyEvent,
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
      {result.link ? (
        <>
          {" "}
          <Link href={result.link.href}>{result.link.label}</Link>
        </>
      ) : null}
    </p>
  );
}

export type EventFields = {
  id?: string;
  /** Its type's key. */
  kind: string;
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
  repeatsWeekly: boolean;
};

/** A type's own line: who usually runs one, and an example. */
function aboutType(type: EventType | undefined): string {
  if (!type) return "";
  const tidy = (text: string) => text.trim().replace(/\.$/, "");
  return [type.runBy ? `Usually run by: ${tidy(type.runBy)}.` : "", type.example ? `Such as: ${tidy(type.example)}.` : ""]
    .filter(Boolean)
    .join(" ");
}

/** The details of an event: what it is, when, and who commands it. Used to draft one and to change one. */
export function EventForm({
  event,
  types,
  people,
}: {
  event: EventFields;
  /** The types this member may choose: the ones they may draft, and the event's own. */
  types: EventType[];
  people: Named[];
}) {
  const [result, action, pending] = useActionState(event.id ? updateEvent : createEvent, untouched);
  // After a save is turned down the form shows what was typed. Otherwise it shows the event.
  const held = (key: string, otherwise: string) => result.values?.[key] ?? otherwise;

  // The type, the length and the weapons state are held here, because choosing
  // the type of a new event fills in the other two with that type's usual ones.
  const [kind, setKind] = useState(event.kind);
  const [duration, setDuration] = useState(String(event.duration));
  const [weaponsState, setWeaponsState] = useState<string>(event.weaponsState);
  const type = types.find((entry) => entry.key === kind);
  const choose = (key: string) => {
    setKind(key);
    const chosen = types.find((entry) => entry.key === key);
    if (!event.id && chosen) {
      setDuration(String(chosen.defaultDuration));
      setWeaponsState(chosen.defaultWeaponsState ?? "");
    }
  };
  const about = aboutType(type);

  // The form is drawn afresh after each answer, so a list shows what is now true
  // after a save, and what was chosen after a refusal.
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      {event.id ? <input type="hidden" name="id" value={event.id} /> : null}

      <div className="field">
        <label htmlFor="kind">Type</label>
        <p className="hint" id="kind_hint">
          Command drafts any type. Instructors draft the types open to them.
          {event.id ? "" : " Choosing a type sets its usual length and weapons state."}
        </p>
        <select id="kind" name="kind" value={kind} onChange={(change) => choose(change.target.value)} required aria-describedby="kind_hint kind_about">
          {types.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.name}
            </option>
          ))}
        </select>
        <p className="type-about" id="kind_about" aria-live="polite">
          {about}
        </p>
      </div>

      <div className="field">
        <label htmlFor="title">Title</label>
        <p className="hint" id="title_hint">
          A short name, such as Patrol 001. A number at the end goes up by one when the event is copied or repeats.
        </p>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={held("title", event.title)}
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
          defaultValue={held("summary", event.summary)}
          maxLength={200}
          autoComplete="off"
          aria-describedby="summary_hint"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={held("date", event.date)} required />
        </div>
        <div className="field">
          <label htmlFor="time">Start, in UTC</label>
          <input id="time" name="time" type="time" defaultValue={held("time", event.time)} required />
        </div>
        <div className="field">
          <label htmlFor="duration">Minutes</label>
          <input
            id="duration"
            name="duration"
            type="number"
            value={duration}
            onChange={(change) => setDuration(change.target.value)}
            min={15}
            max={480}
            step={5}
            required
          />
        </div>
      </div>
      <p className="field-note">
        Orders use UTC. A warning order goes out at least 72 hours before, and the roll closes 24 hours before.
      </p>

      <div className="field">
        <label className="choice" htmlFor="repeats_weekly">
          <input
            id="repeats_weekly"
            name="repeats_weekly"
            type="checkbox"
            defaultChecked={result.values ? result.values.repeats_weekly === "on" : event.repeatsWeekly}
            aria-describedby="repeats_weekly_hint"
          />
          <span>Repeats weekly</span>
        </label>
        <p className="hint" id="repeats_weekly_hint">
          When this one is closed, or cancelled after it was announced, next week&apos;s is drafted with the same details and
          orders. A draft is never announced by itself.
        </p>
      </div>

      <div className="field">
        <label htmlFor="commander">Operation commander</label>
        <p className="hint" id="commander_hint">
          They command everyone present, whatever rank anyone wears.
        </p>
        <select id="commander" name="commander" defaultValue={held("commander", event.commander)} required aria-describedby="commander_hint">
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
        <select id="second" name="second" defaultValue={held("second", event.second)} aria-describedby="second_hint">
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
        <select id="observer" name="observer" defaultValue={held("observer", event.observer)} aria-describedby="observer_hint">
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
        <select id="weapons_state" name="weapons_state" value={weaponsState} onChange={(change) => setWeaponsState(change.target.value)}>
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
          defaultValue={held("pve_fallback", event.pveFallback)}
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

/** One button: draft another event like this one, with its details and orders. */
export function CopyButton({ id }: { id: string }) {
  const [result, action, pending] = useActionState(copyEvent, untouched);
  return (
    <form action={action} className="copy-event">
      <input type="hidden" name="id" value={id} />
      <button className="button button-quiet" type="submit" disabled={pending}>
        {pending ? "Copying" : "Draft another like this"}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** The warning order and the five sections of the operation order, named as the event's type names them. */
export function OrdersForm({ id, orders, sections }: { id: string; orders: Record<string, string>; sections: Section[] }) {
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
      {sections.map((section) => (
        <div className="field" key={section.key}>
          <label htmlFor={section.key}>{section.name}</label>
          <p className="hint" id={`${section.key}_hint`}>
            {section.holds}
          </p>
          <textarea
            id={section.key}
            name={section.key}
            rows={section.key === "mission" ? 2 : 4}
            maxLength={section.max}
            defaultValue={orders[section.key]}
            aria-describedby={`${section.key}_hint`}
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
