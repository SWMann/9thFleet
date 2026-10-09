"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Icon } from "@/components/Icon";
import { UnitSymbol } from "@/components/UnitSymbol";
import { bringsOf, forceOf, strengthLine, strengthOf, tidyChoice, unitsUnder, type ForceUnit } from "@/lib/force";
import { saveUnits, type OpsResult } from "./actions";

const untouched: OpsResult = { ok: false, message: "" };

const kindName = (kind: string) => kind[0].toUpperCase() + kind.slice(1);

/**
 * Which force an event uses, chosen from a chart of the order of battle.
 *
 * Each unit is drawn with its symbol or its picture, how many posts it has and
 * how many are filled. Its posts, who fills them and what it brings open
 * beneath it. Adding a unit brings everything under it. Beside the chart is
 * what the units added come to, which changes as they are added.
 */
export function ForceChart({ id, fleet, chosen }: { id: string; fleet: ForceUnit; chosen: string[] }) {
  const [result, action, pending] = useActionState(saveUnits, untouched);
  const saved = tidyChoice(fleet, chosen);
  const [added, setAdded] = useState(saved);
  const force = forceOf(fleet, added);
  const unsaved = added.length !== saved.length || added.some((unit) => !saved.includes(unit));
  const failed = !result.ok && result.message !== "";

  const toggle = (unit: ForceUnit) =>
    setAdded((current) => {
      if (current.includes(unit.id)) return current.filter((entry) => entry !== unit.id);
      // Adding a ship takes over from its departments added one at a time.
      const under = unitsUnder(unit);
      return [...current.filter((entry) => !under.includes(entry)), unit.id];
    });

  const branch = (unit: ForceUnit, above: ForceUnit | null, carriedBy: string | null) => {
    const root = above === null;
    const on = added.includes(unit.id);
    const strength = strengthOf(unit);
    const brings = bringsOf(unit);
    const part = unit.kind === "department";
    const classes = [
      "force-node",
      on || carriedBy ? "force-node-on" : "",
      unit.open ? "" : "force-node-later",
      root ? "force-node-root" : "",
      part ? "force-node-part" : "",
    ];
    return (
      <li className="force-branch" key={unit.id}>
        <div className={classes.filter(Boolean).join(" ")}>
          {unit.picture ? (
            <span className="force-picture">
              <Image src={unit.picture.src} alt="" fill sizes="260px" style={{ objectPosition: unit.picture.focus }} />
              <Link className="credit credit-bottom-right" href={unit.picture.credit} prefetch={false}>
                Picture: {unit.picture.author}
              </Link>
            </span>
          ) : null}
          <div className="force-node-head">
            {unit.picture ? null : (
              <span className="force-symbol">
                <UnitSymbol kind={unit.kind} />
              </span>
            )}
            <span className="force-node-name">
              <b id={`force-${unit.id}`}>
                {unit.name}
                {/* A department is told from its namesake on another ship. */}
                {unit.kind === "department" && above ? <span className="visually-hidden">, {above.name}</span> : null}
              </b>
              <small>
                {/* A department sits under its ship, which says what it is. Its kind is still read out. */}
                <span className={part ? "visually-hidden" : undefined}>{kindName(unit.kind)}. </span>
                {unit.open ? strengthLine(strength) : `Opens at stage ${unit.opensAtStage}`}
              </small>
            </span>
          </div>

          {root || !unit.open ? null : (
            <label className="force-pick">
              <input
                type="checkbox"
                name="unit"
                value={unit.id}
                checked={on || carriedBy !== null}
                disabled={carriedBy !== null}
                onChange={() => toggle(unit)}
                aria-labelledby={`force-${unit.id}`}
              />
              <span aria-hidden="true">{carriedBy ? `With ${carriedBy}` : on ? "Added" : "Add"}</span>
            </label>
          )}

          {unit.open && (unit.posts.length > 0 || brings.length > 0) ? (
            <details className="force-more">
              <summary>
                {unit.posts.length > 0 ? "Posts and what it brings" : "What it brings"}
                <span className="visually-hidden">: {unit.name}</span>
              </summary>
              {brings.length > 0 ? (
                <ul className="force-brings">
                  {brings.map((thing) => (
                    <li key={thing}>{thing}</li>
                  ))}
                </ul>
              ) : (
                <p className="force-none">Nothing is listed for it yet.</p>
              )}
              {unit.posts.length > 0 ? (
                <ul className="force-posts">
                  {unit.posts.map((post) => (
                    <li key={post.id}>
                      <span>{post.title}</span>
                      {post.holders.length > 0 ? <b>{post.holders.join(", ")}</b> : <i>Empty</i>}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}
        </div>

        {unit.open && unit.units.length > 0 ? (
          <ul>{unit.units.map((child) => branch(child, unit, on ? unit.name : carriedBy))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <form action={action} className="force">
      <input type="hidden" name="id" value={id} />

      <section className="pane force-chart" aria-labelledby="units">
        <h2 className="pane-title" id="units">
          <Icon name="ship" size={18} />
          <span>Which force to use</span>
        </h2>
        <p className="hint">
          Add a whole unit, or one part of it. Adding a unit brings everything under it. With none added, the whole
          fleet takes part.
        </p>
        <div className="force-scroll">
          <ul className="force-tree">{branch(fleet, null, null)}</ul>
        </div>
      </section>

      <section className="pane force-sum" aria-labelledby="this-force">
        <h2 className="pane-title" id="this-force">
          <Icon name="people" size={18} />
          <span>This force</span>
        </h2>
        <p className="visually-hidden" role="status">
          This force: {strengthLine(force).toLowerCase()}.
        </p>
        <dl className="force-tally">
          <div>
            <dt>Posts</dt>
            <dd>{force.posts}</dd>
          </div>
          <div>
            <dt>Filled</dt>
            <dd>{force.filled}</dd>
          </div>
          <div>
            <dt>Empty</dt>
            <dd>{force.posts - force.filled}</dd>
          </div>
        </dl>

        <h3 className="force-label">Units</h3>
        {force.whole ? <p className="hint">No unit is added, so the whole fleet takes part.</p> : null}
        <ul className="force-units">
          {force.units.map((unit) => (
            <li key={unit.id}>
              <b>{unit.name}</b>
              <span>{strengthLine(unit)}</span>
            </li>
          ))}
        </ul>

        <h3 className="force-label">What it brings</h3>
        {force.brings.length > 0 ? (
          <ul className="force-brings">
            {force.brings.map((thing) => (
              <li key={thing}>{thing}</li>
            ))}
          </ul>
        ) : (
          <p className="force-none">Nothing is listed for {force.whole ? "any unit" : force.units.length === 1 ? "this unit" : "these units"} yet.</p>
        )}
        <p className="hint">What a unit brings is a list an admin keeps for it, under Structure.</p>

        <div className="form-end">
          <button className="button button-quiet" type="submit" disabled={pending}>
            {pending ? "Saving" : "Save the force"}
          </button>
          <p className={failed ? "form-result form-result-bad" : "form-result"} role="status">
            {failed ? result.message : unsaved ? "Not saved yet." : result.message}
          </p>
        </div>
      </section>
    </form>
  );
}
