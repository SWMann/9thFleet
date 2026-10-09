import type { Metadata } from "next";
import Link from "next/link";
import { RichLine } from "@/components/rich/Rich";
import { plainText } from "@/lib/rich/markdown";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { ManualBar } from "@/components/manual/ManualBar";
import { Reading } from "@/components/manual/Reading";
import { PageHead } from "@/components/PageHead";
import { RoleChips } from "@/components/roles/RoleChips";
import { count, getRoles, gradeSpan, shipsOf, type Role } from "@/lib/roles";

type Props = PageProps<"/roles/[area]">;

async function find(params: Props["params"]) {
  const { area: slug } = await params;
  const result = await getRoles();
  if (result.state === "no-database") return { state: "no-database" as const };
  const area = result.areas.find((entry) => entry.slug === slug);
  if (!area) return { state: "not-found" as const };
  return { state: "ready" as const, area, stage: result.stage };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (found.state !== "ready") return { title: "Roles" };
  return { title: `${found.area.name}: roles`, description: plainText(found.area.about) };
}

export default function AreaPage({ params }: Props) {
  return (
    <>
      <ManualBar current="role" />
      <Suspense fallback={<PageHead picture="roles" title={<strong>Roles</strong>} lead="Reading the area." />}>
        <Area params={params} />
      </Suspense>
    </>
  );
}

async function Area({ params }: { params: Props["params"] }) {
  const found = await find(params);
  if (found.state === "no-database") {
    return <PageHead picture="roles" title={<strong>Roles</strong>} lead="This site is not connected to the fleet's database yet." />;
  }
  if (found.state === "not-found") notFound();
  const { area, stage } = found;

  return (
    <>
      <PageHead
        picture={area.picture}
        before={
          <p className="back">
            <Link href="/roles">All areas</Link>
          </p>
        }
        title={<strong>{area.name}</strong>}
        lead={<RichLine text={area.about} />}
      />

      <section className="wrap band" aria-labelledby="roles">
        <h2 id="roles">
          Roles in this <strong>area</strong>
        </h2>
        {area.roles.length === 0 ? (
          <div className="prose">
            <p>
              This area has no roles yet. {area.planned ? `It opens at stage ${area.planned.stage}, and the` : "The"} fleet is at stage {stage}.
            </p>
            <p>Its roles and posts are added when that stage comes near. Volume 1 of the manual sets out how the area is built.</p>
          </div>
        ) : (
          <ul className="role-cards">
            {area.roles.map((role) => (
              <li className={role.open ? "role-card" : "role-card role-card-later"} key={role.slug}>
                <p className="role-card-chips">
                  {role.posts > 0 ? <RoleChips role={role} /> : <span className="chip">No posts yet</span>}
                </p>
                <h3>
                  <Link href={`/roles/${area.slug}/${role.slug}`}>{role.name}</Link>
                </h3>
                {role.summary ? (
                  <p className="role-card-summary">
                    <RichLine text={role.summary} />
                  </p>
                ) : null}
                <Facts role={role} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wrap band band-last" aria-labelledby="reading">
        <h2 id="reading">
          What to <strong>read</strong>
        </h2>
        <Reading area={area.reading} />
      </section>

      <Link className="back-bar" href="/roles">
        <Icon name="arrow" size={22} className="flip" />
        <strong>Back to overview</strong>
        <span>Every other area of the fleet</span>
      </Link>
    </>
  );
}

/** The few facts a card carries: its grades, how many posts, and the ships it is found on. */
function Facts({ role }: { role: Role }) {
  const ships = shipsOf(role);
  const openTo = role.places.map((place) => place.openTo).find(Boolean);
  if (role.posts === 0) return null;
  return (
    <dl className="role-card-facts">
      {role.grades ? (
        <div>
          <dt>Grade</dt>
          <dd className="grade">{gradeSpan(role.grades)}</dd>
        </div>
      ) : null}
      {openTo ? (
        <div>
          <dt>Open to</dt>
          <dd>
            <span className="grade">{openTo.grade}</span> and above
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{role.kind === "duty" ? "Held as" : "Posts"}</dt>
        <dd>{role.kind === "duty" ? "A pool" : count(role.posts, "post", "posts")}</dd>
      </div>
      <div>
        <dt>Found on</dt>
        <dd>{ships.length <= 2 ? ships.join(" and ") : `${ships.length} ships`}</dd>
      </div>
    </dl>
  );
}
