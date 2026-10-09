import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getOrderOfBattle, postsWithin, type Holder, type Post, type Tally, type Unit } from "@/lib/order-of-battle";
import { PageHead } from "@/components/PageHead";
import { UnitSymbol } from "@/components/UnitSymbol";

export const metadata: Metadata = {
  title: "Order of battle",
  robots: { index: false, follow: false },
};

export default function OrderOfBattlePage() {
  return (
    <Suspense fallback={<Head lead="Reading the order of battle." />}>
      <OrderOfBattle />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: React.ReactNode }) {
  return (
    <PageHead
      picture="fleet"
      title={
        <>
          Order of <strong>battle</strong>
        </>
      }
      lead={lead}
    >
      {children}
    </PageHead>
  );
}

async function OrderOfBattle() {
  const result = await getOrderOfBattle();

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "outside") {
    return (
      <Head lead="The order of battle is for the serving fleet. You will see it once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }

  const { fleet, tally } = result;
  return (
    <>
      <Head lead={`Every unit and post in the ${fleet.name}, who holds each one, and which are vacant.`}>
        <Strength tally={tally} />
      </Head>

      <section className="wrap band" aria-labelledby="reading">
        <h2 id="reading">How to read this</h2>
        <div className="prose">
          <ul>
            <li>A post is your standing place in a unit. You hold one at a time, and it gives you your rank.</li>
            <li>A duty is a part-time staff job held as well as a post. It carries no rank.</li>
            <li>
              A post opens when the fleet reaches its stage. The fleet is at stage {tally.stage}, so later posts are
              listed but cannot be filled yet.
            </li>
          </ul>
        </div>
      </section>

      {fleet.posts.length > 0 ? <Band unit={{ ...fleet, units: [] }} level={2} /> : null}
      {fleet.units.map((unit) => (
        <Formation key={unit.id} unit={unit} level={2} />
      ))}
      <div className="band-end" />
    </>
  );
}

function Strength({ tally }: { tally: Tally }) {
  const figures = [
    { label: "Stage", value: tally.stage },
    { label: "Posts open", value: tally.open },
    { label: "Filled", value: tally.filled },
    { label: "Vacant", value: tally.vacant },
    { label: "Opening later", value: tally.later },
  ];
  return (
    <dl className="tally">
      {figures.map((figure) => (
        <div key={figure.label}>
          <dt>{figure.label}</dt>
          <dd>{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Level = 2 | 3 | 4 | 5;
const deeper = (level: Level): Level => (level < 5 ? ((level + 1) as Level) : 5);

function Title({ level, id, className, children }: { level: Level; id?: string; className: string; children: React.ReactNode }) {
  const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5";
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

/** A department is shown inside its ship. Anything else below a unit stands on its own. */
const isDepartment = (unit: Unit) => unit.kind === "department";

/**
 * A unit with posts of its own, or with departments, is one band. A unit that
 * only groups other units, such as a task force, is a heading above theirs.
 */
function Formation({ unit, level }: { unit: Unit; level: Level }) {
  const standsAlone = unit.posts.length > 0 || unit.units.length === 0 || unit.units.every(isDepartment);
  if (standsAlone) return <Band unit={unit} level={level} />;

  return (
    <>
      <div className="formation">
        <div className="wrap">
          <Title level={level} className="formation-name with-symbol">
            <UnitSymbol kind={unit.kind} size={20} />
            {unit.name}
          </Title>
          <p>{describe(unit)}</p>
        </div>
      </div>
      {unit.units.map((child) => (
        <Formation key={child.id} unit={child} level={deeper(level)} />
      ))}
    </>
  );
}

function Band({ unit, level }: { unit: Unit; level: Level }) {
  const all = postsWithin(unit);
  const departments = unit.units.filter(isDepartment);
  const others = unit.units.filter((child) => !isDepartment(child));
  const titleId = `unit-${unit.id}`;

  const groups = (
    <>
      {unit.posts.length > 0 ? <Posts posts={unit.posts} showAll={!unit.open} /> : null}
      {departments.map((department) => (
        <div className="unit-group" key={department.id}>
          <Title level={deeper(level)} className="unit-group-name">
            {department.name}
            {unit.open && !department.open ? (
              <span className="aside">Opens at stage {department.opensAtStage}</span>
            ) : null}
          </Title>
          <Posts posts={postsWithin(department)} showAll={!unit.open} />
        </div>
      ))}
    </>
  );

  return (
    <>
      <section className="wrap band" aria-labelledby={titleId}>
        <div>
          <Title level={level} id={titleId} className="band-title with-symbol">
            <UnitSymbol kind={unit.kind} />
            {unit.name}
          </Title>
          <p className="band-note">{describe(unit)}</p>
        </div>
        <div>
          {unit.open ? (
            groups
          ) : (
            <details className="later">
              <summary>
                Show {all.length === 1 ? "its post" : `its ${all.length} posts`}
                <span className="visually-hidden"> in {unit.name}</span>
              </summary>
              {groups}
            </details>
          )}
        </div>
      </section>
      {others.map((child) => (
        <Formation key={child.id} unit={child} level={deeper(level)} />
      ))}
    </>
  );
}

const kindNames: Record<string, string> = {
  fleet: "Fleet",
  command: "Command",
  staff: "Staff",
  "task force": "Task force",
  ship: "Ship",
  flight: "Flight",
  department: "Department",
};
const serviceNames = { navy: "Navy", army: "Army", marines: "Marines" } as const;

/** One line under a unit's name: what it is, and how full it is. */
function describe(unit: Unit): string {
  // "Fleet Staff" does not need telling that it is staff.
  const kind = kindNames[unit.kind] ?? capitalise(unit.kind);
  const what = [
    unit.name.toLowerCase().includes(kind.toLowerCase()) ? null : kind,
    unit.service ? serviceNames[unit.service] : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lead = what ? `${what}. ` : "";
  if (!unit.open) return `${lead}Opens at stage ${unit.opensAtStage}.`;

  const open = postsWithin(unit).filter((post) => post.open);
  const posts = open.filter((post) => post.kind === "primary");
  if (posts.length > 0) {
    const filled = posts.filter((post) => post.holders.length > 0).length;
    return `${lead}${filled} of ${posts.length} ${posts.length === 1 ? "post" : "posts"} filled.`;
  }
  const duties = open.length;
  if (duties > 0) return `${lead}${duties} ${duties === 1 ? "duty" : "duties"} open.`;
  return lead.trim();
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The posts of one unit. Posts that are open come first. Posts that open at a
 * later stage are tucked away, unless the whole unit is being shown at once.
 */
function Posts({ posts, showAll }: { posts: Post[]; showAll: boolean }) {
  const open = showAll ? posts : posts.filter((post) => post.open);
  const later = showAll ? [] : posts.filter((post) => !post.open);

  return (
    <>
      {open.length > 0 ? (
        <ul className="posts">
          {open.map((post) => (
            <PostLine key={post.id} post={post} />
          ))}
        </ul>
      ) : null}
      {later.length > 0 ? (
        <details className="later">
          <summary>{later.length === 1 ? "1 more opens later" : `${later.length} more open later`}</summary>
          <ul className="posts">
            {later.map((post) => (
              <PostLine key={post.id} post={post} />
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function PostLine({ post }: { post: Post }) {
  const details = [terms(post), post.entry ? "Entry post" : null, needs(post)].filter(Boolean).join(". ");
  return (
    <li className={post.open ? "post" : "post post-later"}>
      <span className="post-title">{post.title}</span>
      <div className="post-holder">
        <Holders post={post} />
      </div>
      {details ? <p className="post-details">{details}.</p> : null}
    </li>
  );
}

/** The grades a post is held at, or who may take on a duty. */
function terms(post: Post): string | null {
  if (post.kind === "duty") return post.openTo ? `Duty, open to ${post.openTo} and above` : "Duty";
  if (!post.band) return null;
  const { from, to, fromRank, toRank } = post.band;
  const grades = from === to ? from : `${from} to ${to}`;
  if (!fromRank || !toRank) return grades;
  return `${fromRank === toRank ? fromRank : `${fromRank} to ${toRank}`} (${grades})`;
}

function needs(post: Post): string | null {
  if (post.requirements.length === 0) return null;
  const names = post.requirements.map((requirement) =>
    requirement.waivedWhenActing ? `${requirement.name} (not when acting)` : requirement.name,
  );
  return `Needs ${names.join(", ")}`;
}

function Holders({ post }: { post: Post }) {
  if (post.holders.length === 0) {
    if (!post.open) return <span className="post-state">Opens at stage {post.opensAtStage}</span>;
    return post.kind === "duty" ? <span className="post-state">Nobody yet</span> : <span className="tag">Vacant</span>;
  }
  return (
    <ul className="holders">
      {post.holders.map((holder) => (
        <li key={holder.memberId}>
          {nameOf(holder)}
          {holder.you ? <span className="tag tag-you">You</span> : null}
        </li>
      ))}
    </ul>
  );
}

function nameOf(holder: Holder): string {
  const name = holder.name ?? "Name not set";
  if (!holder.rankName) return name;
  return `${holder.acting ? "Acting " : ""}${holder.rankName} ${name}`;
}
