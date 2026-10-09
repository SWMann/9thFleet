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
import { count, getRoles, gradeSpan, placeName, rankSpan, shipsOf, type AreaWithRoles, type Place, type Role, type RoleLink } from "@/lib/roles";

type Props = PageProps<"/roles/[area]/[role]">;

async function find(params: Props["params"]) {
  const { area: areaSlug, role: roleSlug } = await params;
  const result = await getRoles();
  if (result.state === "no-database") return { state: "no-database" as const };
  const area = result.areas.find((entry) => entry.slug === areaSlug);
  const role = area?.roles.find((entry) => entry.slug === roleSlug);
  if (!area || !role) return { state: "not-found" as const };
  const everyRole = result.areas.flatMap((entry) => entry.roles);
  return { state: "ready" as const, area, role, stage: result.stage, everyRole };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (found.state !== "ready") return { title: "Role" };
  return {
    title: `${found.role.name}: ${found.area.name}`,
    description: `${plainText(leadOf(found.role, found.area))} Its grades, what it needs, where it leads and the ships it is found on in the UEE 9th Fleet.`,
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

/** What the role is, in a sentence: its own summary if one has been written, or what the records say. */
function leadOf(role: Role, area: AreaWithRoles): string {
  if (role.summary) return role.summary;
  if (role.kind === "duty") return `A secondary duty in ${area.name}, held as well as a post.`;
  if (role.posts === 0) return `A role in ${area.name}. It has no posts in the order of battle yet.`;
  return `A role in ${area.name}, with ${count(role.posts, "post", "posts")} on ${listOf(shipsOf(role))}.`;
}

const listOf = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

async function RoleCard({ params }: { params: Props["params"] }) {
  const found = await find(params);
  if (found.state === "no-database") {
    return <PageHead picture="roles" slim title={<strong>Role</strong>} lead="This site is not connected to the fleet's database yet." />;
  }
  if (found.state === "not-found") notFound();
  const { area, role, stage, everyRole } = found;
  const ships = shipsOf(role);
  const others = area.roles.filter((entry) => entry.slug !== role.slug);
  const openTo = role.places.map((place) => place.openTo).find(Boolean) ?? null;
  // The steps on from this role, as far as they are set.
  const onward: RoleLink[] = [];
  for (let step = role.next; step && onward.length < 6; ) {
    onward.push(step);
    step = everyRole.find((entry) => entry.slug === step!.slug)?.next ?? null;
  }
  const extras = extraNeeds(role);

  return (
    <>
      <PageHead
        picture={area.picture}
        before={
          <p className="back">
            <Link href={`/roles/${area.slug}`}>{area.name}</Link>
          </p>
        }
        title={<strong>{role.name}</strong>}
        lead={<RichLine text={leadOf(role, area)} />}
      >
        <p className="chips">
          {role.posts > 0 ? <RoleChips role={role} /> : <span className="chip">No posts yet</span>}
          {role.kind === "primary" && role.posts > 0 ? <span className="chip">{count(role.posts, "post", "posts")}</span> : null}
        </p>
      </PageHead>

      <section className="wrap band" aria-labelledby="brief">
        <h2 id="brief">
          The role in <strong>brief</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>Kind</dt>
            <dd>
              {role.kind === "primary" ? "Primary role" : "Secondary duty"}
              <span className="aside">{role.kind === "primary" ? "Its post sets the holder's grade and rank" : "It carries no rank"}</span>
            </dd>
          </div>
          <div>
            <dt>Area</dt>
            <dd>
              <Link href={`/roles/${area.slug}`}>{area.name}</Link>
            </dd>
          </div>
          {role.grades ? (
            <div>
              <dt>Grade</dt>
              <dd>
                <span className="grade">{gradeSpan(role.grades)}</span>
                <span className="aside">{role.places.length > 1 ? "Across every ship. Each post has its own band" : "The band of its post"}</span>
              </dd>
            </div>
          ) : null}
          {role.kind === "duty" ? (
            <div>
              <dt>Open to</dt>
              <dd>
                {openTo ? (
                  <>
                    <span className="grade">{openTo.grade}</span> and above
                  </>
                ) : (
                  "No grade is set"
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{role.kind === "duty" ? "Held on" : "Found on"}</dt>
            <dd>
              {ships.length > 0 ? listOf(ships) : "Nowhere yet"}
              {role.kind === "primary" && role.posts > 0 ? <span className="aside">{count(role.posts, "post", "posts")}</span> : null}
            </dd>
          </div>
          <div>
            <dt>Opens</dt>
            <dd>
              {role.posts === 0 ? "No posts yet" : role.open ? "Open now" : `At stage ${role.opensAtStage}`}
              <span className="aside">The fleet is at stage {stage}</span>
            </dd>
          </div>
          <div>
            <dt>Needs</dt>
            <dd>
              {role.requirements.length > 0 ? role.requirements.map((requirement) => requirement.name).join(", ") : "Nothing of its own yet"}
              {extras.length > 0 ? <span className="aside">Some posts need more</span> : null}
            </dd>
          </div>
          {role.next || role.from.length > 0 ? (
            <div>
              <dt>Leads to</dt>
              <dd>
                {role.next ? <Link href={`/roles/${role.next.area}/${role.next.slug}`}>{role.next.name}</Link> : "Nothing set"}
                {role.from.length > 0 ? <span className="aside">Comes from {listOf(role.from.map((entry) => entry.name))}</span> : null}
              </dd>
            </div>
          ) : null}
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

      {role.duties.length > 0 ? (
        <section className="wrap band" aria-labelledby="does">
          <h2 id="does">
            What the role <strong>does</strong>
          </h2>
          <ul className="duties">
            {role.duties.map((duty) => (
              <li key={duty}>{duty}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {role.next || role.from.length > 0 ? (
        <section className="wrap band" aria-labelledby="leads">
          <h2 id="leads">
            Where it <strong>leads</strong>
          </h2>
          <ol className="progression">
            {role.from.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/roles/${entry.area}/${entry.slug}`}>{entry.name}</Link>
              </li>
            ))}
            <li aria-current="step">
              <span>{role.name}</span>
            </li>
            {onward.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/roles/${entry.area}/${entry.slug}`}>{entry.name}</Link>
              </li>
            ))}
          </ol>
          <p className="after-facts">
            A move to the next role is an appointment, made by command when a post is open and its holder is ready.{" "}
            <Link href="/manual/command/appointments">How appointments work</Link>.
          </p>
        </section>
      ) : null}

      {role.places.length > 0 ? (
        <section className="wrap band" aria-labelledby="found">
          <h2 id="found">
            Where it is <strong>found</strong>
          </h2>
          <ul className="role-cards places">
            {role.places.map((place) => (
              <li className={place.open ? "role-card" : "role-card role-card-later"} key={place.path.join("/")}>
                <p className="role-card-chips">
                  {place.open ? <span className="chip chip-on">Open now</span> : <span className="chip">Opens at stage {place.opensAtStage}</span>}
                  {place.entryPosts > 0 ? <span className="chip chip-gold">Entry post</span> : null}
                </p>
                <h3>{place.where}</h3>
                <p className="role-card-where">{place.path.join(" › ")}</p>
                <PlaceFacts place={place} role={role} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {role.requirements.length > 0 || extras.length > 0 ? (
        <section className="wrap band" aria-labelledby="qualify">
          <h2 id="qualify">
            How you <strong>qualify</strong>
          </h2>
          <ul className="cards">
            {role.requirements.map((requirement) => (
              <li className="card" key={requirement.name}>
                <Icon name="checks" size={30} />
                <h3>{requirement.name}</h3>
                <p>
                  <RichLine text={requirement.description} />
                </p>
                <p className="state">
                  Every {role.name} needs this{requirement.waivedWhenActing ? ". An acting holder is let off while they prove themselves" : ""}
                </p>
              </li>
            ))}
            {extras.map((requirement) => (
              <li className="card" key={requirement.name}>
                <Icon name="checks" size={30} />
                <h3>{requirement.name}</h3>
                <p>
                  <RichLine text={requirement.description} />
                </p>
                <p className="state">
                  {requirement.everyPost ? `Every ${role.name} post needs this` : `Needed on ${listOf(requirement.where)}`}
                  {requirement.waivedWhenActing ? ". An acting holder is let off while they prove themselves" : ""}
                </p>
              </li>
            ))}
          </ul>
          {role.entry ? (
            <p className="after-cards">
              A recruit earns the entry qualifications on the way in. <Link href="/joining">How joining works</Link> sets out each step.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="reading">
        <h2 id="reading">
          What to <strong>read</strong>
        </h2>
        <Reading role={role.reading} area={area.reading} />
        <p className="reading-note">
          Voice procedure, drills and the detail of each role arrive with later volumes of the <Link href="/manual">fleet manual</Link>.
        </p>
      </section>

      {others.length > 0 ? (
        <section className="wrap band band-last" aria-labelledby="others">
          <h2 id="others">
            Other roles in this <strong>area</strong>
          </h2>
          <ul className="role-cards">
            {others.map((entry) => (
              <li className={entry.open ? "role-card" : "role-card role-card-later"} key={entry.slug}>
                <p className="role-card-chips">{entry.posts > 0 ? <RoleChips role={entry} /> : <span className="chip">No posts yet</span>}</p>
                <h3>
                  <Link href={`/roles/${area.slug}/${entry.slug}`}>{entry.name}</Link>
                </h3>
                {entry.summary ? (
                  <p className="role-card-summary">
                    <RichLine text={entry.summary} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link className="back-bar" href={`/roles/${area.slug}`}>
        <Icon name="arrow" size={22} className="flip" />
        <strong>Back to {area.name}</strong>
        <span>Every role in this area</span>
      </Link>
    </>
  );
}

/** The posts in one place: what they are called there, their grades and when they open. */
function PlaceFacts({ place, role }: { place: Place; role: Role }) {
  const ranks = place.band ? rankSpan(place.band) : null;
  const named = place.titles.length === 1 && place.titles[0].title === role.name;
  return (
    <dl className="role-card-facts">
      <div>
        <dt>{role.kind === "duty" ? "Held as" : "Posts"}</dt>
        <dd>
          {role.kind === "duty"
            ? "A pool"
            : named
              ? count(place.posts, "post", "posts")
              : place.titles.map((entry) => `${entry.posts} ${entry.title}`).join(", ")}
        </dd>
      </div>
      {place.band ? (
        <div>
          <dt>Grade</dt>
          <dd>
            <span className="grade">{gradeSpan(place.band)}</span>
            {ranks ? <small>{ranks}</small> : null}
          </dd>
        </div>
      ) : null}
      {place.openTo ? (
        <div>
          <dt>Open to</dt>
          <dd>
            <span className="grade">{place.openTo.grade}</span> and above
          </dd>
        </div>
      ) : null}
      {place.lastOpensAtStage > place.opensAtStage ? (
        <div>
          <dt>Opens</dt>
          <dd>
            Stage {place.opensAtStage} to {place.lastOpensAtStage}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** What posts need on top of the role's own needs, with the places that need it. */
function extraNeeds(role: Role) {
  const found = new Map<string, { name: string; description: string; waivedWhenActing: boolean; posts: number; where: string[] }>();
  for (const place of role.places) {
    for (const requirement of place.extra) {
      const known = found.get(requirement.name);
      if (known) {
        known.posts += requirement.posts;
        known.where.push(placeName(place));
      } else {
        found.set(requirement.name, { ...requirement, where: [placeName(place)] });
      }
    }
  }
  return [...found.values()]
    .filter((requirement) => !role.requirements.some((own) => own.name === requirement.name))
    .map((requirement) => ({ ...requirement, everyPost: requirement.posts === role.posts }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
