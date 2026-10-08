import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { ManualBar } from "@/components/manual/ManualBar";
import { Reading } from "@/components/manual/Reading";
import { PageHead } from "@/components/PageHead";
import { RoleChips } from "@/components/roles/RoleChips";
import { areas, otherArea } from "@/lib/areas";
import { count, getRoles, gradeSpan } from "@/lib/roles";

type Props = PageProps<"/roles/[area]">;

const findArea = (slug: string) => [...areas, otherArea].find((area) => area.slug === slug);

export function generateStaticParams() {
  return areas.map((area) => ({ area: area.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const area = findArea((await params).area);
  return area ? { title: `${area.name}: roles`, description: area.about } : { title: "Roles" };
}

export default async function AreaPage({ params }: Props) {
  const area = findArea((await params).area);
  if (!area) notFound();

  return (
    <>
      <ManualBar current="role" />
      <PageHead
        picture={area.picture}
        before={
          <p className="back">
            <Link href="/roles">All areas</Link>
          </p>
        }
        title={<strong>{area.name}</strong>}
        lead={area.about}
      />

      <section className="wrap band" aria-labelledby="posts">
        <h2 id="posts">
          Posts in this <strong>area</strong>
        </h2>
        <Suspense fallback={<p>Reading the posts.</p>}>
          <Posts slug={area.slug} />
        </Suspense>
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

async function Posts({ slug }: { slug: string }) {
  const result = await getRoles();
  if (result.state === "no-database") return <p>This site is not connected to the fleet&apos;s database yet.</p>;
  const area = result.areas.find((entry) => entry.slug === slug);
  if (!area || area.roles.length === 0) {
    const stage = area?.opensAtStage ?? findArea(slug)?.planned?.stage;
    return (
      <div className="prose">
        <p>
          This area has no posts in the order of battle yet. {stage ? `It opens at stage ${stage}, and the` : "The"} fleet
          is at stage {result.stage}.
        </p>
        <p>Its posts are added when that stage comes near. Volume 1 of the manual sets out how the area is built.</p>
      </div>
    );
  }

  // One group for each ship, flight or headquarters, in the order of battle's own order.
  const places = [...new Set(area.roles.map((role) => role.where))];
  return (
    <>
      {places.map((place) => (
        <div className="role-group" key={place}>
          <h3 className="role-group-name">{place}</h3>
          <ul className="role-cards">
            {area.roles
              .filter((role) => role.where === place)
              .map((role) => (
                <li className={role.open ? "role-card" : "role-card role-card-later"} key={role.slug}>
                  <p className="role-card-chips">
                    <RoleChips role={role} />
                  </p>
                  <h4>
                    <Link href={`/roles/${area.slug}/${role.slug}`}>{role.title}</Link>
                  </h4>
                  <p className="role-card-where">{role.unit === role.where ? role.where : `${role.unit}, ${role.where}`}</p>
                  <dl className="role-card-facts">
                    {role.band ? (
                      <div>
                        <dt>Grade</dt>
                        <dd className="grade">{gradeSpan(role.band)}</dd>
                      </div>
                    ) : null}
                    {role.openTo ? (
                      <div>
                        <dt>Open to</dt>
                        <dd>
                          <span className="grade">{role.openTo.grade}</span> and above
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{role.kind === "duty" ? "Duties" : "Posts"}</dt>
                      <dd>{role.kind === "duty" ? "A pool" : count(role.posts, "post", "posts")}</dd>
                    </div>
                  </dl>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}
