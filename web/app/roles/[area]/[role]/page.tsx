import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";
import { ManualBar } from "@/components/manual/ManualBar";
import { Reading } from "@/components/manual/Reading";
import { PageHead } from "@/components/PageHead";
import { RoleChips } from "@/components/roles/RoleChips";
import { count, getRoles, gradeSpan, rankSpan, type AreaWithRoles, type Role } from "@/lib/roles";

type Props = PageProps<"/roles/[area]/[role]">;

async function find(params: Props["params"]) {
  const { area: areaSlug, role: roleSlug } = await params;
  const result = await getRoles();
  if (result.state === "no-database") return { state: "no-database" as const };
  const area = result.areas.find((entry) => entry.slug === areaSlug);
  const role = area?.roles.find((entry) => entry.slug === roleSlug);
  if (!area || !role) return { state: "not-found" as const };
  return { state: "ready" as const, area, role, stage: result.stage };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (found.state !== "ready") return { title: "Role" };
  return {
    title: `${found.role.title}, ${found.role.where}`,
    description: `${summaryOf(found.role)} Its grade, what it needs and where it sits in the UEE 9th Fleet.`,
  };
}

export default function RolePage({ params }: Props) {
  return (
    <>
      <ManualBar current="role" />
      <Suspense fallback={<PageHead picture="roles" slim title={<strong>Role</strong>} lead="Reading the role." />}>
        <RoleCard params={params} />
      </Suspense>
    </>
  );
}

const placeOf = (role: Role) => (role.unit === role.where ? role.where : `${role.unit}, ${role.where}`);

/** One sentence on what the role is. */
function summaryOf(role: Role): string {
  if (role.kind === "duty") return `A secondary duty on the ${role.where}, held as well as a post.`;
  const many = role.posts > 1 ? `One of ${role.posts} ${role.title} posts in ${placeOf(role)}.` : `A post in ${placeOf(role)}.`;
  return role.entry ? `${many} It is an entry post, which a new member can apply for.` : many;
}

async function RoleCard({ params }: { params: Props["params"] }) {
  const found = await find(params);
  if (found.state === "no-database") {
    return (
      <PageHead
        picture="roles"
        slim
        title={<strong>Role</strong>}
        lead="This site is not connected to the fleet's database yet."
      />
    );
  }
  if (found.state === "not-found") notFound();
  const { area, role, stage } = found;
  const ranks = role.band ? rankSpan(role.band) : null;
  const others = area.roles.filter((entry) => entry.slug !== role.slug);

  return (
    <>
      <PageHead
        picture={area.picture}
        before={
          <p className="back">
            <Link href={`/roles/${area.slug}`}>{area.name}</Link>
          </p>
        }
        title={<strong>{role.title}</strong>}
        lead={summaryOf(role)}
      >
        <p className="chips">
          <RoleChips role={role} />
          {role.kind === "primary" ? <span className="chip">{count(role.posts, "post", "posts")}</span> : null}
        </p>
      </PageHead>

      <section className="wrap band" aria-labelledby="brief">
        <h2 id="brief">
          The post in <strong>brief</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>Kind</dt>
            <dd>
              {role.kind === "primary" ? "Primary post" : "Secondary duty"}
              <span className="aside">
                {role.kind === "primary" ? "It sets its holder's grade and rank" : "It carries no rank"}
              </span>
            </dd>
          </div>
          {role.band ? (
            <div>
              <dt>Grade</dt>
              <dd>
                <span className="grade">{gradeSpan(role.band)}</span>
                {ranks ? <span className="aside">{ranks}</span> : null}
              </dd>
            </div>
          ) : null}
          {role.kind === "duty" ? (
            <div>
              <dt>Open to</dt>
              <dd>
                {role.openTo ? (
                  <>
                    <span className="grade">{role.openTo.grade}</span> and above
                  </>
                ) : (
                  "No grade is set"
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Where</dt>
            <dd>{role.path.join(" › ")}</dd>
          </div>
          <div>
            <dt>Opens</dt>
            <dd>
              {role.open ? "Open now" : `At stage ${role.opensAtStage}`}
              <span className="aside">
                {role.lastOpensAtStage > role.opensAtStage
                  ? `The last of them opens at stage ${role.lastOpensAtStage}. `
                  : ""}
                The fleet is at stage {stage}
              </span>
            </dd>
          </div>
          <div>
            <dt>Needs</dt>
            <dd>
              {role.requirements.length > 0
                ? role.requirements.map((requirement) => requirement.name).join(", ")
                : "No qualification is set yet"}
            </dd>
          </div>
          <div>
            <dt>Held by</dt>
            <dd>
              <Link href="/order-of-battle">The order of battle</Link>
              <span className="aside">Shown to serving members</span>
            </dd>
          </div>
        </dl>
        {role.kind === "primary" ? (
          <p className="after-facts">
            Rank follows the post. Its holder wears the rank of the grade they hold, inside the post&apos;s band.{" "}
            <Link href="/ranks">See every rank</Link>.
          </p>
        ) : (
          <p className="after-facts">
            A duty is held as well as a post, one at most, and goes on the service record.{" "}
            <Link href="/manual/organisation/primary-posts-and-secondary-duties">How duties work</Link>.
          </p>
        )}
      </section>

      {role.requirements.length > 0 ? (
        <section className="wrap band" aria-labelledby="qualify">
          <h2 id="qualify">
            How you <strong>qualify</strong>
          </h2>
          <ul className="cards">
            {role.requirements.map((requirement) => (
              <li className="card" key={requirement.name}>
                <Icon name="checks" size={30} />
                <h3>{requirement.name}</h3>
                <p>{requirement.description}</p>
                {requirement.waivedWhenActing ? (
                  <p className="state">An acting holder is let off this while they prove themselves</p>
                ) : null}
              </li>
            ))}
          </ul>
          {role.entry ? (
            <p className="after-cards">
              A recruit earns these on the way in. <Link href="/joining">How joining works</Link> sets out each step.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="reading">
        <h2 id="reading">
          What to <strong>read</strong>
        </h2>
        <Reading area={area.reading} />
        <p className="reading-note">
          Voice procedure, drills and the detail of each post arrive with later volumes of the{" "}
          <Link href="/manual">fleet manual</Link>.
        </p>
      </section>

      {others.length > 0 ? <Others area={area} roles={others} /> : null}

      <Link className="back-bar" href={`/roles/${area.slug}`}>
        <Icon name="arrow" size={22} className="flip" />
        <strong>Back to {area.name}</strong>
        <span>Every post in this area</span>
      </Link>
    </>
  );
}

function Others({ area, roles }: { area: AreaWithRoles; roles: Role[] }) {
  return (
    <section className="wrap band band-last" aria-labelledby="others">
      <h2 id="others">
        Other posts in this <strong>area</strong>
      </h2>
      <ul className="role-cards">
        {roles.map((role) => (
          <li className={role.open ? "role-card" : "role-card role-card-later"} key={role.slug}>
            <p className="role-card-chips">
              <RoleChips role={role} />
            </p>
            <h3>
              <Link href={`/roles/${area.slug}/${role.slug}`}>{role.title}</Link>
            </h3>
            <p className="role-card-where">{placeOf(role)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
