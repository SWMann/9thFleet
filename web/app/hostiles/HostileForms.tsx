"use client";

import { useActionState } from "react";
import { RichField } from "@/components/rich/RichField";
import { STANDS_FOR, handleNames, kindNames, levelMeaning, levelNames, type HostileKind, type HostileLevel } from "@/lib/hostile-form";
import { decideHostile, liftHostile, moveHostile, proposeHostile, renewHostile, rewordHostile, withdrawHostile, type HostileResult } from "./actions";

const untouched: HostileResult = { ok: false, message: "" };

function Result({ result }: { result: HostileResult }) {
  return (
    <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
      {result.message}
    </p>
  );
}

const kinds: HostileKind[] = ["individual", "organisation"];
const levels: HostileLevel[] = ["hostile", "watch"];

/**
 * Put a name forward. `start` fills the form in to begin with, when it was
 * opened from a report. Command may also list the name there and then.
 */
export function ProposeForm({ command, start = {} }: { command: boolean; start?: Record<string, string> }) {
  const [result, action, pending] = useActionState(proposeHostile, untouched);
  // What was typed comes back when it was turned down. After a success the form is empty again.
  const values = result.values ?? (result.ok ? {} : start);
  const kind = (values.kind === "organisation" ? "organisation" : "individual") as HostileKind;
  const level = (values.level === "watch" ? "watch" : "hostile") as HostileLevel;

  return (
    <form action={action} className="fields fields-wide hostile-form" key={result.stamp ?? 0}>
      <fieldset className="field choices">
        <legend>Who is it?</legend>
        {kinds.map((entry) => (
          <label key={entry} className="choice">
            <input type="radio" name="kind" value={entry} defaultChecked={entry === kind} required />
            <span>{kindNames[entry]}</span>
          </label>
        ))}
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor="hostile_handle">Handle or organisation ID</label>
          <p className="hint" id="hostile_handle_hint">
            As the game shows it: a player&apos;s {handleNames.individual}, or an organisation&apos;s ID. Never a real name.
          </p>
          <input
            id="hostile_handle"
            name="handle"
            type="text"
            defaultValue={values.handle ?? ""}
            required
            minLength={2}
            maxLength={60}
            pattern="[A-Za-z0-9_\-]{2,60}"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="hostile_handle_hint"
          />
        </div>
        <div className="field">
          <label htmlFor="hostile_name">
            Also known as <span className="optional">Optional</span>
          </label>
          <p className="hint" id="hostile_name_hint">
            An organisation&apos;s full name, or another name the player uses in the game.
          </p>
          <input id="hostile_name" name="name" type="text" defaultValue={values.name ?? ""} maxLength={80} autoComplete="off" aria-describedby="hostile_name_hint" />
        </div>
      </div>

      <fieldset className="field choices">
        <legend>{command ? "List it as" : "What you think it should be"}</legend>
        {levels.map((entry) => (
          <label key={entry} className="choice">
            <input type="radio" name="level" value={entry} defaultChecked={entry === level} required />
            <span>
              {levelNames[entry]}
              <small>{levelMeaning[entry]}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="hostile_reason">What happened</label>
        <p className="hint" id="hostile_reason_hint">
          What they did in the game, where and when. Keep to what was seen. Nothing about anyone outside the game belongs here.
        </p>
        <RichField id="hostile_reason" name="reason" rows={5} maxLength={2000} required defaultValue={values.reason ?? ""} describedBy="hostile_reason_hint" />
      </div>

      <div className="field">
        <label htmlFor="hostile_evidence">
          Evidence <span className="optional">Optional</span>
        </label>
        <p className="hint" id="hostile_evidence_hint">
          Web addresses of a screenshot or a clip, one to a line, each starting https://
        </p>
        <textarea id="hostile_evidence" name="evidence" rows={3} maxLength={1000} defaultValue={values.evidence ?? ""} spellCheck={false} aria-describedby="hostile_evidence_hint" />
      </div>

      {command ? (
        <div className="field">
          <label className="choice">
            <input type="checkbox" name="outright" defaultChecked={values.outright === "on"} />
            <span>
              List it now
              <small>As command you may list a name without it waiting. Leave this off to put it forward like anyone else.</small>
            </span>
          </label>
        </div>
      ) : null}

      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Sending" : "Put it forward"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Command's answer to a name that was put forward: list it, at one level or the other, or decline it. */
export function DecideForms({ id, handle, suggested }: { id: string; handle: string; suggested: HostileLevel }) {
  const [result, action, pending] = useActionState(decideHostile, untouched);
  const noteId = `decide_note_${id}`;
  const answer = (decision: "listed" | "declined", level: HostileLevel | null, label: string, ask: string, primary: boolean) => (
    <details className="confirm">
      <summary className={primary ? "button" : "button button-quiet"}>{label}</summary>
      <form action={action} className="confirm-body">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value={decision} />
        {level ? <input type="hidden" name="level" value={level} /> : null}
        <p>{ask}</p>
        <div className="field">
          <label htmlFor={`${noteId}_${level ?? "no"}`}>
            A word of why <span className="optional">Optional</span>
          </label>
          <input id={`${noteId}_${level ?? "no"}`} name="note" type="text" maxLength={500} autoComplete="off" />
        </div>
        <button className="button" type="submit" disabled={pending}>
          {decision === "listed" ? "Yes, list it" : "Yes, decline"}
        </button>
      </form>
    </details>
  );

  return (
    <div className="decisions">
      {answer("listed", "hostile", "List as hostile", `List ${handle} as hostile? ${levelMeaning.hostile}`, suggested === "hostile")}
      {answer("listed", "watch", "List on watch", `Put ${handle} on watch? ${levelMeaning.watch}`, suggested === "watch")}
      {answer("declined", null, "Decline", `Decline ${handle}? Whoever put it forward is shown your answer.`, false)}
      <Result result={result} />
    </div>
  );
}

/** What command does with a listed entry: renew it, move it between hostile and watch, rewrite it, lift it. */
export function KeepForms({
  entry,
}: {
  entry: { id: string; handle: string; kind: HostileKind; name: string; level: HostileLevel; reason: string; evidence: string; lapses: boolean };
}) {
  const [renewed, renew, renewing] = useActionState(renewHostile, untouched);
  const [moved, move, moving] = useActionState(moveHostile, untouched);
  const [lifted, lift, lifting] = useActionState(liftHostile, untouched);
  const [reworded, reword, rewording] = useActionState(rewordHostile, untouched);
  const other: HostileLevel = entry.level === "hostile" ? "watch" : "hostile";
  const words = reworded.values ?? { name: entry.name, reason: entry.reason, evidence: entry.evidence };
  const answers = [renewed, moved, lifted, reworded].filter((result) => result.message !== "");

  return (
    <div className="decisions">
      {entry.lapses ? (
        <form action={renew}>
          <input type="hidden" name="id" value={entry.id} />
          <button className="button button-quiet" type="submit" disabled={renewing}>
            Renew for {STANDS_FOR} days
          </button>
        </form>
      ) : null}

      <details className="confirm">
        <summary className="button button-quiet">{other === "watch" ? "Move to watch" : "Make hostile"}</summary>
        <form action={move} className="confirm-body">
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="level" value={other} />
          <p>
            {other === "watch" ? `Move ${entry.handle} to watch?` : `Make ${entry.handle} hostile?`} {levelMeaning[other]}
          </p>
          <button className="button" type="submit" disabled={moving}>
            {other === "watch" ? "Yes, move to watch" : "Yes, make hostile"}
          </button>
        </form>
      </details>

      <details className="confirm">
        <summary className="button button-quiet">Rewrite</summary>
        <form action={reword} className="confirm-body fields fields-wide" key={reworded.stamp ?? 0}>
          <input type="hidden" name="id" value={entry.id} />
          <div className="field">
            <label htmlFor={`reword_name_${entry.id}`}>
              Also known as <span className="optional">Optional</span>
            </label>
            <input id={`reword_name_${entry.id}`} name="name" type="text" defaultValue={words.name ?? ""} maxLength={80} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor={`reword_reason_${entry.id}`}>What happened</label>
            <RichField id={`reword_reason_${entry.id}`} name="reason" rows={4} maxLength={2000} required defaultValue={words.reason ?? ""} />
          </div>
          <div className="field">
            <label htmlFor={`reword_evidence_${entry.id}`}>
              Evidence <span className="optional">Optional</span>
            </label>
            <textarea id={`reword_evidence_${entry.id}`} name="evidence" rows={3} maxLength={1000} defaultValue={words.evidence ?? ""} spellCheck={false} />
          </div>
          <button className="button" type="submit" disabled={rewording}>
            {rewording ? "Saving" : "Save the entry"}
          </button>
        </form>
      </details>

      <details className="confirm">
        <summary className="button button-quiet">Lift</summary>
        <form action={lift} className="confirm-body">
          <input type="hidden" name="id" value={entry.id} />
          <p>Lift {entry.handle}? It comes off the list, and is kept with the past entries.</p>
          <div className="field">
            <label htmlFor={`lift_note_${entry.id}`}>
              A word of why <span className="optional">Optional</span>
            </label>
            <input id={`lift_note_${entry.id}`} name="note" type="text" maxLength={500} autoComplete="off" />
          </div>
          <button className="button" type="submit" disabled={lifting}>
            Yes, lift it
          </button>
        </form>
      </details>

      {answers.map((result, index) => (
        <Result result={result} key={index} />
      ))}
    </div>
  );
}

/** Take back a name the reader put forward themselves. */
export function WithdrawForm({ id, handle }: { id: string; handle: string }) {
  const [result, action, pending] = useActionState(withdrawHostile, untouched);
  return (
    <div className="decisions">
      <details className="confirm">
        <summary className="button button-quiet">Take it back</summary>
        <form action={action} className="confirm-body">
          <input type="hidden" name="id" value={id} />
          <p>Take {handle} back? It will not go to command.</p>
          <button className="button" type="submit" disabled={pending}>
            Yes, take it back
          </button>
        </form>
      </details>
      <Result result={result} />
    </div>
  );
}
