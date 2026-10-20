import Link from "next/link";
import { HullCard, modelChoices } from "@/components/ships/HullCard";
import type { Member } from "@/lib/member";
import type { Register } from "@/lib/ships";
import { readyWords } from "@/lib/ships-form";
import { ShipForm } from "@/app/ships/ShipForms";

/**
 * The Ships tab of a serving member's record: the hulls they own, with the
 * tools to mark, change and remove them, and the form to register another.
 * The fleet's own hulls and everyone else's are command's, under Fleet admin.
 */
export function YourShips({ member, result }: { member: Member; result: Register }) {
  if (result.state !== "ready") {
    return (
      <section className="wrap band band-last" aria-labelledby="your-ships">
        <h2 id="your-ships">Your ships</h2>
        <p className="intro">{result.state === "no-database" ? "This site is not connected to the fleet's database yet." : "The register is for the serving fleet."}</p>
      </section>
    );
  }
  const { ships, models, templates, readAt: now } = result;
  const mine = ships.filter((ship) => ship.ownerId === member.id);
  const ready = mine.filter((ship) => ship.ready).length;
  const choices = modelChoices(models);
  const standardOf = new Map(templates.filter((template) => template.isDefault).map((template) => [template.modelId, template]));

  return (
    <>
      <section className="wrap band" aria-labelledby="your-ships">
        <h2 id="your-ships">Your ships</h2>
        <p className="intro">
          {mine.length === 0
            ? "You have registered nothing yet. Register the ships you own below, and mark each one ready when it could sail tonight."
            : `${mine.length === 1 ? "One hull" : `${mine.length} hulls`}, ${readyWords(ready, mine.length)}. Mark a ship not ready when it is down for repair, and in claim when it was lost; either takes it off what you have offered. The fleet sees your ships on the `}
          {mine.length === 0 ? null : <Link href="/ships">fleet board</Link>}
          {mine.length === 0 ? null : "; your note is for you and command only."}
        </p>
        {mine.length > 0 ? (
          <ul className="hulls">
            {mine.map((ship) => (
              <HullCard key={ship.id} ship={ship} template={standardOf.get(ship.model.id) ?? null} now={now} choices={choices} owners={[]} command={false} showOwner={false} />
            ))}
          </ul>
        ) : null}
      </section>
      <section className="wrap band band-last" aria-labelledby="register">
        <h2 id="register">Register a ship</h2>
        <p className="intro">Each of the ships you own, by its model. A model missing from the list is added by an admin under Structure.</p>
        <ShipForm ship={null} models={choices} owners={[]} command={false} />
      </section>
    </>
  );
}
