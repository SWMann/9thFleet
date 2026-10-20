import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Scroll } from "@/components/admin/Charts";
import { PageHead } from "@/components/PageHead";
import { getRegister } from "@/lib/ships";
import { boardAddress, narrowed, narrowingFrom, stateWords } from "@/lib/ships-board";
import { readyWords } from "@/lib/ships-form";
import { shipKindOf, shipKinds } from "@/lib/structure";

export const metadata: Metadata = {
  title: "The fleet board",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The fleet <strong>board</strong>
  </>
);

type Props = { searchParams: Promise<{ kind?: string | string[]; role?: string | string[]; ready?: string | string[] }> };

export default function ShipsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Head lead="Reading the register." />}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="fleet" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

/**
 * The register summed by model: what the fleet holds, what is ready, and who
 * owns what. Each row leads to the model's page. Members manage their own
 * hulls from their record; command manages any under Fleet admin.
 */
async function Board({ searchParams }: Props) {
  const [result, params] = await Promise.all([getRegister(), searchParams]);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The fleet board is for the serving fleet. You will see it once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { member, ships, roles, strength, board, seatsReady, servingCount } = result;
  const mine = ships.filter((ship) => ship.ownerId === member.id).length;
  const ready = ships.filter((ship) => ship.ready).length;
  const lead =
    ships.length === 0
      ? "Nothing is registered yet. Register the ships you own from your record, and mark each one ready when it could sail."
      : `${ships.length} ${ships.length === 1 ? "hull" : "hulls"} on the register, ${readyWords(ready, ships.length)}. ${mine === 0 ? "None of them is yours yet." : `${mine} ${mine === 1 ? "is" : "are"} yours.`}`;

  const asked = narrowingFrom(params);
  const shown = narrowed(board, asked);
  const kindsShown = shipKinds.filter((kind) => board.some((row) => row.model.kind === kind.key));
  const rolesShown = roles.filter((role) => board.some((row) => row.model.roles.some((held) => held.slug === role.slug)));
  const narrowedAtAll = asked.kind !== null || asked.role !== null || asked.ready;

  return (
    <>
      <Head lead={lead}>
        <p className="actions">
          <Link className="button button-quiet" href="/profile?tab=ships">
            Register a ship
          </Link>
          <Link className="button button-quiet" href="/ships/models">
            The models
          </Link>
        </p>
      </Head>

      {strength.length > 0 ? (
        <section className="wrap band" aria-labelledby="readiness">
          <h2 id="readiness">
            What could <strong>sail tonight</strong>
          </h2>
          <ul className="strength-tiles">
            {strength.map((line) => (
              <li key={line.kind} className={line.ready === line.hulls ? "strength-tile strength-tile-good" : line.ready === 0 ? "strength-tile strength-tile-bad" : "strength-tile"}>
                <strong>{line.ready}</strong>
                <span>
                  of {line.hulls} {line.hulls === 1 ? line.name.replace(/s$/, "").toLowerCase() : line.name.toLowerCase()} ready
                </span>
              </li>
            ))}
          </ul>
          <p className="seats-line">
            {seatsReady === 0 ? "No seats aboard what is ready" : `${seatsReady} ${seatsReady === 1 ? "seat" : "seats"} aboard what is ready`}, by the models with stations set; {servingCount} serving.
          </p>
          <p className="intro">
            Each owner marks their own ships, from their record. A ship marked not ready or in claim is withdrawn from the events it was offered for; whoever runs an
            event sees what is offered against what the plan needs.
          </p>
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="board">
        <h2 id="board">
          The <strong>board</strong>
        </h2>
        {board.length === 0 ? (
          <p className="intro">The register is empty.</p>
        ) : (
          <>
            <p className="chips chips-left" aria-label="Narrow the board">
              <Chip on={!narrowedAtAll} href="/ships">
                Everything
              </Chip>
              <span className="chips-break" aria-hidden="true" />
              {kindsShown.map((kind) => (
                <Chip key={kind.key} on={asked.kind === kind.key} href={boardAddress("/ships", { ...asked, kind: asked.kind === kind.key ? null : kind.key })}>
                  {kind.many}
                </Chip>
              ))}
              <span className="chips-break" aria-hidden="true" />
              {rolesShown.map((role) => (
                <Chip key={role.slug} on={asked.role === role.slug} href={boardAddress("/ships", { ...asked, role: asked.role === role.slug ? null : role.slug })} title={role.description}>
                  {role.name}
                </Chip>
              ))}
              <span className="chips-break" aria-hidden="true" />
              <Chip on={asked.ready} href={boardAddress("/ships", { ...asked, ready: !asked.ready })}>
                Only ready
              </Chip>
            </p>
            {shown.length === 0 ? (
              <p className="intro">
                Nothing on the board fits that. <Link href="/ships">Show everything.</Link>
              </p>
            ) : (
              <Scroll label="The fleet board">
                <table className="data data-board">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Kind</th>
                      <th scope="col" className="number">
                        Hulls
                      </th>
                      <th scope="col" className="number">
                        Ready
                      </th>
                      <th scope="col">State</th>
                      <th scope="col" className="number">
                        Seats ready
                      </th>
                      <th scope="col">Owners</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <tr key={row.model.id}>
                        <th scope="row">
                          <Link href={`/ships/models/${row.model.slug}`}>{row.model.name}</Link>
                          <small>
                            {row.model.maker ? `${row.model.maker}. ` : ""}
                            {row.model.roles.map((role) => role.name).join(", ")}
                          </small>
                        </th>
                        <td>{shipKindOf(row.model.kind).name}</td>
                        <td className="number">{row.hulls}</td>
                        <td className="number">{row.ready}</td>
                        <td>{stateWords(row)}</td>
                        <td className="number">{row.seats === 0 ? "No stations set" : row.seatsReady}</td>
                        <td>{row.owners.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Chip({ on, href, title, children }: { on: boolean; href: string; title?: string; children: ReactNode }) {
  return (
    <Link className={on ? "chip chip-link chip-on" : "chip chip-link"} href={href} aria-current={on ? "true" : undefined} title={title || undefined}>
      {children}
    </Link>
  );
}
