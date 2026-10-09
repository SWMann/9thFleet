"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useActionState, useState } from "react";
import {
  returnedNames,
  serviceNames,
  weapons,
  type Approval,
  type EventType,
  type Reply,
  type Returned,
  type Section,
  type WeaponsState,
} from "@/lib/operations-form";
import {
  addExtraPosts,
  addOpforMember,
  changeOpforMember,
  copyEvent,
  createEvent,
  fileReport,
  fileReturn,
  moveEvent,
  removeExtraPost,
  replyToEvent,
  saveKeyPosts,
  saveOpforPlan,
  saveOrders,
  saveUnits,
  setApproval,
  setPlace,
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
  openToRecruits: boolean;
  openToService: string;
  requiresQualification: string;
  /** Empty for no limit, and for no minimum. */
  places: string;
  minimumAttending: string;
  musterAt: string;
  area: string;
  teachesQualification: string;
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
  qualifications,
}: {
  event: EventFields;
  /** The types this member may choose: the ones they may draft, and the event's own. */
  types: EventType[];
  people: Named[];
  qualifications: { id: string; name: string }[];
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
    <form action={action} className="event-form" key={result.stamp ?? 0}>
      {event.id ? <input type="hidden" name="id" value={event.id} /> : null}

      <div className="panes">
        <fieldset className="pane">
          <legend className="pane-title">
            <Icon name="calendar" size={18} />
            <span>What and when</span>
          </legend>
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
            <label htmlFor="muster_at">
              Muster at <span className="optional">Optional</span>
            </label>
            <p className="hint" id="muster_at_hint">
              Where to be 15 minutes before the start, such as Baijini Point, pad 04.
            </p>
            <input
              id="muster_at"
              name="muster_at"
              type="text"
              defaultValue={held("muster_at", event.musterAt)}
              maxLength={120}
              autoComplete="off"
              aria-describedby="muster_at_hint"
            />
          </div>

          <div className="field">
            <label htmlFor="area">
              Area <span className="optional">Optional</span>
            </label>
            <p className="hint" id="area_hint">
              Where the event takes place, such as the lane between ArcCorp and microTech.
            </p>
            <input id="area" name="area" type="text" defaultValue={held("area", event.area)} maxLength={120} autoComplete="off" aria-describedby="area_hint" />
          </div>
        </fieldset>
        <fieldset className="pane">
          <legend className="pane-title">
            <Icon name="star" size={18} />
            <span>Who runs it</span>
          </legend>
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
        </fieldset>
        <fieldset className="pane">
          <legend className="pane-title">
            <Icon name="people" size={18} />
            <span>Who it is open to</span>
          </legend>
          <div className="field">
            <label className="choice" htmlFor="open_to_recruits">
              <input
                id="open_to_recruits"
                name="open_to_recruits"
                type="checkbox"
                defaultChecked={result.values ? result.values.open_to_recruits === "on" : event.openToRecruits}
              />
              <span>Open to recruits</span>
            </label>
          </div>
          <div className="field">
            <label htmlFor="open_to_service">Service</label>
            <select id="open_to_service" name="open_to_service" defaultValue={held("open_to_service", event.openToService)}>
              <option value="">Every service</option>
              {Object.entries(serviceNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name} only
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="requires_qualification">
              Qualification needed <span className="optional">Optional</span>
            </label>
            <p className="hint" id="requires_qualification_hint">
              Only members who hold it can reply that they are attending. Whoever is named to run the event or to observe
              always can.
            </p>
            <select
              id="requires_qualification"
              name="requires_qualification"
              defaultValue={held("requires_qualification", event.requiresQualification)}
              aria-describedby="requires_qualification_hint"
            >
              <option value="">None</option>
              {qualifications.map((qualification) => (
                <option key={qualification.id} value={qualification.id}>
                  {qualification.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="places">
                Places <span className="optional">Optional</span>
              </label>
              <input id="places" name="places" type="number" min={1} max={500} step={1} defaultValue={held("places", event.places)} aria-describedby="places_hint" />
            </div>
            <div className="field">
              <label htmlFor="minimum_attending">
                Minimum <span className="optional">Optional</span>
              </label>
              <input
                id="minimum_attending"
                name="minimum_attending"
                type="number"
                min={1}
                max={500}
                step={1}
                defaultValue={held("minimum_attending", event.minimumAttending)}
                aria-describedby="places_hint"
              />
            </div>
          </div>
          <p className="field-note" id="places_hint">
            Replies past the number of places go on a reserve list, in the order they arrive. The minimum is how many must
            attend for the event to go ahead. Leave either empty for none.
          </p>
        </fieldset>
        <fieldset className="pane">
          <legend className="pane-title">
            <Icon name="clock" size={18} />
            <span>Repeats and teaching</span>
          </legend>
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
            <label htmlFor="teaches_qualification">
              Qualification taught <span className="optional">Optional</span>
            </label>
            <p className="hint" id="teaches_qualification_hint">
              For a training event that ends in a qualification. Once it has started, an instructor signs off who passed
              from the event&apos;s page.
            </p>
            <select
              id="teaches_qualification"
              name="teaches_qualification"
              defaultValue={held("teaches_qualification", event.teachesQualification)}
              aria-describedby="teaches_qualification_hint"
            >
              <option value="">None</option>
              {qualifications.map((qualification) => (
                <option key={qualification.id} value={qualification.id}>
                  {qualification.name}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
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
    <form action={action} className="fields orders-form">
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

/**
 * The two answers a member can give, with the one they have given marked.
 * Someone the event is not open to can only say they are not attending.
 */
export function ReplyForm({ id, reply, onlyDecline = false }: { id: string; reply: Reply | null; onlyDecline?: boolean }) {
  const [result, action, pending] = useActionState(replyToEvent, untouched);
  return (
    <form action={action} className="reply">
      <input type="hidden" name="id" value={id} />
      {onlyDecline ? null : (
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
      )}
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
  approval,
  needsApproval,
  isCommand,
}: {
  id: string;
  state: "draft" | "announced";
  title: string;
  /** The page for changing the details and orders, for someone who may. */
  editHref: string | null;
  mayCancel: boolean;
  /** Where the draft stands with command, and whether its type asks for approval at all. */
  approval: Approval;
  needsApproval: boolean;
  isCommand: boolean;
}) {
  const [result, action, pending] = useActionState(moveEvent, untouched);
  const [asked, ask, asking] = useActionState(setApproval, untouched);
  // A type that needs approval is announced by command, or by anyone once command has approved the draft.
  const waits = state === "draft" && needsApproval && approval !== "approved";
  const approve = (value: Approval, words: string, quiet = true) => (
    <form action={ask}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="approval" value={value} />
      <button className={quiet ? "button button-quiet" : "button"} type="submit" disabled={asking}>
        {words}
      </button>
    </form>
  );
  return (
    <div className="decisions">
      {editHref ? (
        <Link className="button button-quiet" href={editHref}>
          Change the details and orders
        </Link>
      ) : null}
      {waits && !isCommand ? (
        approval === "asked" ? (
          <>
            <p className="decisions-note">Waiting for command&apos;s approval. It can be announced once command has approved it.</p>
            {approve("not_asked", "Take the request back")}
          </>
        ) : (
          <>
            <p className="decisions-note">This type of event needs command&apos;s approval before it is announced.</p>
            {approve("asked", "Ask command to approve it", false)}
          </>
        )
      ) : null}
      {waits && isCommand ? approve("approved", "Approve it") : null}
      {state === "draft" && needsApproval && approval === "approved" ? (
        <>
          <p className="decisions-note">Command has approved this draft.</p>
          {isCommand ? approve("not_asked", "Take the approval back") : null}
        </>
      ) : null}
      {state === "draft" && !(waits && !isCommand) ? (
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
      <Result result={asked} />
    </div>
  );
}

/** The opposing force's plan, for command and whoever leads it. */
export function OpforPlanForm({ id, plan }: { id: string; plan: string }) {
  const [result, action, pending] = useActionState(saveOpforPlan, untouched);
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="opfor_plan">The opposing force&apos;s plan</label>
        <p className="hint" id="opfor_plan_hint">
          What the opposing force is to do, where and when. Only command and its members can read it.
        </p>
        <textarea
          id="opfor_plan"
          name="plan"
          rows={6}
          maxLength={6000}
          defaultValue={result.values?.plan ?? plan}
          aria-describedby="opfor_plan_hint"
        />
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the plan"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** For command: name a member to the opposing force. */
export function OpforAddForm({ id, candidates }: { id: string; candidates: Named[] }) {
  const [result, action, pending] = useActionState(addOpforMember, untouched);
  return (
    <form action={action} className="stand-in opfor-add" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <label className="visually-hidden" htmlFor="opfor_member">
        Name to the opposing force
      </label>
      <select id="opfor_member" name="member" defaultValue="" required>
        <option value="" disabled>
          Choose a member
        </option>
        {candidates.map((person) => (
          <option key={person.id} value={person.id}>
            {label(person)}
          </option>
        ))}
      </select>
      <label className="opfor-leads">
        <input type="checkbox" name="leads" />
        <span>Leads it</span>
      </label>
      <button className="button button-small" type="submit" disabled={pending}>
        Name to the opposing force
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** For command: take a member off the opposing force, or say whether they lead it. */
export function OpforMemberButtons({ id, member, name, leads }: { id: string; member: string; name: string; leads: boolean }) {
  const [result, action, pending] = useActionState(changeOpforMember, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="member" value={member} />
      <button className="link-button" type="submit" name="change" value={leads ? "follow" : "lead"} disabled={pending}>
        {leads ? "No longer leads" : "Make lead"}
        <span className="visually-hidden">: {name}</span>
      </button>
      <button className="link-button" type="submit" name="change" value="remove" disabled={pending}>
        Take off<span className="visually-hidden"> {name}</span>
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/**
 * One button: take a post for the night, or step back out of it. The post is
 * one of the order of battle's (`position`) or one of the event's own (`extra`).
 */
export function StandInButton({ id, position = "", extra = "", children }: { id: string; position?: string; extra?: string; children: string }) {
  const [result, action, pending] = useActionState(setStandIn, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value={position} />
      <input type="hidden" name="extra" value={extra} />
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
  position = "",
  extra = "",
  post,
  spare,
  inPost,
}: {
  id: string;
  /** A post of the order of battle, or one of the event's own. */
  position?: string;
  extra?: string;
  post: string;
  spare: Named[];
  /** Members attending in their own post. Moving one up leaves that post to fill. */
  inPost: Named[];
}) {
  const [result, action, pending] = useActionState(setStandIn, untouched);
  const field = `member_${position || extra}`;
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="position" value={position} />
      <input type="hidden" name="extra" value={extra} />
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

/** For whoever runs the event: one button that gives someone on the reserve list a place. */
export function GivePlace({ id, member, name }: { id: string; member: string; name: string }) {
  const [result, action, pending] = useActionState(setPlace, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="member" value={member} />
      <input type="hidden" name="place" value="in" />
      <button className="button button-small" type="submit" disabled={pending}>
        Give a place<span className="visually-hidden"> to {name}</span>
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** For whoever runs the event: move someone who has a place onto the reserve list. */
export function ToReserve({ id, people }: { id: string; people: Named[] }) {
  const [result, action, pending] = useActionState(setPlace, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="place" value="reserve" />
      <label className="visually-hidden" htmlFor="to_reserve">
        Move to the reserve list
      </label>
      <select id="to_reserve" name="member" defaultValue="" required>
        <option value="" disabled>
          Choose who gives up a place
        </option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {label(person)}
          </option>
        ))}
      </select>
      <button className="button button-small" type="submit" disabled={pending}>
        Move to the reserve list
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

/** Which units take part. With none ticked, every open unit does. */
export function UnitsForm({ id, units, chosen }: { id: string; units: { id: string; label: string }[]; chosen: string[] }) {
  const [result, action, pending] = useActionState(saveUnits, untouched);
  return (
    <form action={action} className="picks" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend>Units taking part</legend>
        <p className="hint">
          Tick the ships and units this event is for, and the roll shows only their posts. A unit brings everything
          under it. With none ticked, every open unit takes part.
        </p>
        <ul>
          {units.map((unit) => (
            <li key={unit.id}>
              <label>
                <input type="checkbox" name="unit" value={unit.id} defaultChecked={chosen.includes(unit.id)} />
                <span>{unit.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the units"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Which posts must be filled for the event to go ahead. */
export function KeyPostsForm({
  id,
  groups,
  chosen,
}: {
  id: string;
  groups: { unit: string; posts: { id: string; title: string }[] }[];
  chosen: string[];
}) {
  const [result, action, pending] = useActionState(saveKeyPosts, untouched);
  return (
    <form action={action} className="picks" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend>Posts that must be filled</legend>
        <p className="hint">
          The event is shown as below its minimum while any of these is empty. The list is the posts of the units taking
          part, so save the units first.
        </p>
        {groups.length === 0 ? <p>No post is open in the units taking part.</p> : null}
        {groups.map((group) => (
          <div className="picks-group" key={group.unit}>
            <h4>{group.unit}</h4>
            <ul>
              {group.posts.map((post) => (
                <li key={post.id}>
                  <label>
                    <input type="checkbox" name="post" value={post.id} defaultChecked={chosen.includes(post.id)} />
                    <span>{post.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </fieldset>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Saving" : "Save the posts"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Add posts that exist for this event only. */
export function ExtraPostForm({ id, roles }: { id: string; roles: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState(addExtraPosts, untouched);
  const held = (key: string, otherwise: string) => result.values?.[key] ?? otherwise;
  return (
    <form action={action} className="fields fields-wide" key={result.stamp ?? 0}>
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="extra_title">Post title</label>
        <p className="hint" id="extra_title_hint">
          Such as Range Safety Officer, Umpire or Trainee.
        </p>
        <input
          id="extra_title"
          name="title"
          type="text"
          defaultValue={held("title", "")}
          required
          minLength={2}
          maxLength={76}
          autoComplete="off"
          aria-describedby="extra_title_hint"
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="extra_role">Role</label>
          <select id="extra_role" name="role" defaultValue={held("role", "")} required>
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="extra_count">How many</label>
          <input id="extra_count" name="count" type="number" min={1} max={12} step={1} defaultValue={held("count", "1")} required />
        </div>
      </div>
      <p className="field-note">The role says what the post does and what to read. More than one are numbered: Trainee 1, Trainee 2.</p>
      <div className="field">
        <label className="choice" htmlFor="extra_must_fill">
          <input id="extra_must_fill" name="must_fill" type="checkbox" defaultChecked={result.values?.must_fill === "on"} />
          <span>It must be filled for the event to go ahead</span>
        </label>
      </div>
      <div className="field">
        <label className="choice" htmlFor="extra_volunteers">
          <input id="extra_volunteers" name="open_to_volunteers" type="checkbox" defaultChecked={result.values?.open_to_volunteers === "on"} />
          <span>An attending member with no post on the night may take it</span>
        </label>
      </div>
      <div className="form-end">
        <button className="button button-quiet" type="submit" disabled={pending}>
          {pending ? "Adding" : "Add the post"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Take one of the event's own posts away. */
export function RemoveExtraPost({ id, post, title }: { id: string; post: string; title: string }) {
  const [result, action, pending] = useActionState(removeExtraPost, untouched);
  return (
    <form action={action} className="stand-in">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="post" value={post} />
      <button className="link-button" type="submit" disabled={pending}>
        Remove<span className="visually-hidden"> the post {title}</span>
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
