import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHead } from "@/components/PageHead";
import { shortfall } from "@/lib/manning";
import { getOperation, type FleetEvent, type Operation, type Person, type RollPost } from "@/lib/operations";
import { formatWhen, returnedNames, serviceNames, stateNames, weapons, weaponsName } from "@/lib/operations-form";
import {
  CopyButton,
  GivePlace,
  MoveForms,
  PlaceForm,
  RemoveStandIn,
  ReplyForm,
  ReportForm,
  ReturnForm,
  StandInButton,
  ToReserve,
} from "../OpsForms";

export const metadata: Metadata = {
  title: "Event",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]">;
type Ready = Extract<Operation, { state: "ready" }>;

export default function EventPage({ params }: Props) {
  return (
    <Suspense fallback={<Head title="Event" lead="Reading the event." />}>
      <Event params={params} />
    </Suspense>
  );
}

function Head({ title, lead, children }: { title: string; lead: string; children?: React.ReactNode }) {
  return (
    <PageHead
      picture="operations"
      before={
        <p className="back">
          <Link href="/operations">Operations</Link>
        </p>
      }
      title={<strong>{title}</strong>}
      lead={lead}
    >
      {children}
    </PageHead>
  );
}

const named = (person: Person | null, none: string) => (person ? [person.rankName, person.name].filter(Boolean).join(" ") : none);

function length(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : null, rest > 0 ? `${rest} minutes` : null];
  return parts.filter(Boolean).join(" ");
}

/** Who an event is open to, in a few words. Null when it is open to every serving member. */
function openTo(event: FleetEvent): string | null {
  if (!event.openToService && !event.requires && event.openToRecruits) return null;
  // "Navy members who hold the Navy crew qualification, but not recruits".
  const who = event.openToService ? `${serviceNames[event.openToService]} members` : "Serving members";
  const holding = event.requires ? ` who hold the ${event.requires.name} qualification` : "";
  return `${who}${holding}${event.openToRecruits ? "" : ", but not recruits"}`;
}

const manningWords = {
  go: "Go",
  short: "Not yet manned",
  "no-go": "Below its minimum",
} as const;

async function Event({ params }: { params: Props["params"] }) {
  const { id } = await params;
  const result = await getOperation(id);

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head title="Event" lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") return <Head title="Event" lead="Operations are for the serving fleet." />;
  if (result.state === "not-found") notFound();

  const { event, orders, sections, runs, edits, report, manning, roll } = result;
  const open_to = openTo(event);
  // Someone who may draft this type of event may draft another like it.
  const mayCopy = result.mayCreate.some((type) => type.key === event.kind);
  const when = formatWhen(event.startsAt);
  const closes = event.rollClosesAt ? formatWhen(event.rollClosesAt) : null;
  const open = event.state === "draft" || event.state === "announced";
  const weaponsMeaning = weapons.find((entry) => entry.key === event.weaponsState)?.meaning;

  return (
    <>
      <Head title={event.title} lead={event.summary || event.kindName}>
        <p className="chips">
          <span className="chip chip-gold">{event.kindName}</span>
          {event.state !== "announced" ? <span className="chip chip-amber">{stateNames[event.state]}</span> : null}
          {event.weaponsState ? <span className="chip">{weaponsName(event.weaponsState)}</span> : null}
          {event.repeatsWeekly ? <span className="chip">Weekly</span> : null}
        </p>
      </Head>

      <section className="wrap band" aria-labelledby="glance">
        <h2 id="glance">
          At a <strong>glance</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>When</dt>
            <dd>
              {when.day}, {when.utc}
              <span className="aside">{when.uk}</span>
            </dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{length(event.durationMinutes)}</dd>
          </div>
          <div>
            <dt>Roll</dt>
            <dd>
              {event.state === "draft"
                ? "Opens when the event is announced"
                : closes
                  ? event.rollOpen
                    ? `Closes ${closes.day}, ${closes.utc}`
                    : "Closed"
                  : "Closed"}
            </dd>
          </div>
          <div>
            <dt>Commander</dt>
            <dd>{named(event.commander, "Not named")}</dd>
          </div>
          <div>
            <dt>Second-in-command</dt>
            <dd>{named(event.second, "To be named from those attending")}</dd>
          </div>
          {event.observer ? (
            <div>
              <dt>Observer</dt>
              <dd>{named(event.observer, "")}</dd>
            </div>
          ) : null}
          {event.weaponsState ? (
            <div>
              <dt>Weapons state</dt>
              <dd>
                {weaponsName(event.weaponsState)}
                <span className="aside">{weaponsMeaning}</span>
              </dd>
            </div>
          ) : null}
          {event.pveFallback ? (
            <div>
              <dt>Fallback</dt>
              <dd>{event.pveFallback}</dd>
            </div>
          ) : null}
          {open_to ? (
            <div>
              <dt>Open to</dt>
              <dd>{open_to}</dd>
            </div>
          ) : null}
          {event.places !== null ? (
            <div>
              <dt>Places</dt>
              <dd>
                {event.places}
                {event.state === "draft" ? null : (
                  <span className="aside">
                    {roll.withPlace.length} taken
                    {roll.reserve.length > 0 ? `, ${roll.reserve.length} on the reserve list` : ""}
                  </span>
                )}
              </dd>
            </div>
          ) : null}
          {event.minimumAttending !== null ? (
            <div>
              <dt>Minimum</dt>
              <dd>{event.minimumAttending} attending</dd>
            </div>
          ) : null}
          {result.taking.names.length > 0 ? (
            <div>
              <dt>Taking part</dt>
              <dd>{result.taking.names.join(", ")}</dd>
            </div>
          ) : null}
          {event.repeatsWeekly ? (
            <div>
              <dt>Repeats</dt>
              <dd>
                Weekly
                <span className="aside">
                  {open ? "Closing it drafts next week's" : "Closing it drafted next week's"}
                </span>
              </dd>
            </div>
          ) : null}
          {result.copiedFrom ? (
            <div>
              <dt>Copied from</dt>
              <dd>
                <Link href={`/operations/${result.copiedFrom.id}`}>{result.copiedFrom.title}</Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {mayCopy ? <CopyButton id={event.id} /> : null}
      </section>

      {manning ? (
        <section className="wrap band" aria-labelledby="manning">
          <h2 id="manning">
            Go or <strong>no-go</strong>
          </h2>
          <div className={`manning manning-${manning.state}`}>
            <p className="manning-word">{manningWords[manning.state]}</p>
            <p>
              {manning.state === "go"
                ? `${manning.attending} attending${manning.minimum !== null ? `, against a minimum of ${manning.minimum}` : ""}, and every post that must be filled has someone in it.`
                : shortfall(manning)}{" "}
              {manning.state === "short" ? "Members can still reply." : manning.state === "no-go" ? "The roll has closed. Whether it goes ahead is the operation commander's decision." : ""}
            </p>
          </div>
        </section>
      ) : null}

      {event.state === "announced" ? <YourReply result={result} /> : null}

      {(runs || edits) && open ? (
        <section className="wrap band" aria-labelledby="running">
          <h2 id="running">
            Running this <strong>event</strong>
          </h2>
          <p className="intro">
            {event.state === "draft"
              ? "This is a draft. Only you, its commander and command can see it."
              : "You run this event, so you keep its orders, fill the gaps on the roll and make the return."}
          </p>
          <MoveForms
            id={event.id}
            state={event.state as "draft" | "announced"}
            title={event.title}
            editHref={edits ? `/operations/${event.id}/edit` : null}
            mayCancel={runs || event.state === "draft"}
          />
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="orders">
        <h2 id="orders">
          The <strong>orders</strong>
        </h2>
        <div className="orders">
          <div className="order">
            <h3>Warning order</h3>
            {orders.warning_order ? <p className="order-text">{orders.warning_order}</p> : <p className="order-none">Not written yet.</p>}
          </div>
          {sections.map((section) => (
            <div className="order" key={section.key}>
              <h3>{section.name}</h3>
              {orders[section.key] ? (
                <p className="order-text">{orders[section.key]}</p>
              ) : (
                <p className="order-none">Not written yet. {section.holds}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {event.state !== "draft" ? <TheRoll result={result} /> : null}

      {runs && event.started && event.state !== "cancelled" ? (
        <>
          <section className="wrap band" aria-labelledby="return">
            <h2 id="return">
              The attendance <strong>return</strong>
            </h2>
            <p className="intro">
              Mark who was there. It feeds each member&apos;s activity record
              {event.state === "done" ? "." : ", and making it closes the event."} A member sees only their own line.
            </p>
            {result.returns.length > 0 ? (
              <ReturnForm id={event.id} lines={result.returns} done={event.state === "done"} />
            ) : (
              <p>Nobody is on the roll.</p>
            )}
          </section>
          <section className="wrap band" aria-labelledby="file">
            <h2 id="file">
              The after-action <strong>report</strong>
            </h2>
            <p className="intro">Due within 48 hours. The fleet reads it, and its lessons become changes to procedure.</p>
            <ReportForm id={event.id} report={report} />
          </section>
        </>
      ) : null}

      {report && !(runs && event.started) ? (
        <section className="wrap band" aria-labelledby="report">
          <h2 id="report">
            After-action <strong>report</strong>
          </h2>
          <p className="intro">
            Filed by {named(report.author, "a member who has left")} on {formatWhen(report.filedAt).day}.
          </p>
          <div className="orders">
            <div className="order">
              <h3>What happened</h3>
              <p className="order-text">{report.whatHappened}</p>
            </div>
            {report.toKeep ? (
              <div className="order">
                <h3>What to keep</h3>
                <p className="order-text">{report.toKeep}</p>
              </div>
            ) : null}
            {report.toChange ? (
              <div className="order">
                <h3>What to change</h3>
                <p className="order-text">{report.toChange}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {result.myReturn && !runs ? (
        <section className="wrap band" aria-labelledby="returned">
          <h2 id="returned">
            Your <strong>attendance</strong>
          </h2>
          <p className="intro">
            The operation commander recorded you as <strong>{returnedNames[result.myReturn].toLowerCase()}</strong>. Only
            you, staff and whoever ran the event can see this.
          </p>
        </section>
      ) : null}
      <div className="band-end" />
    </>
  );
}

function YourReply({ result }: { result: Ready }) {
  const { event, mine, roll } = result;
  const closes = event.rollClosesAt ? formatWhen(event.rollClosesAt) : null;
  const standingIn =
    roll.groups.flatMap((group) => group.posts).find((post) => post.id === mine.standInFor) ??
    roll.extra.find((post) => post.id === mine.extraPost);
  const said =
    mine.reply === "attending"
      ? "You said you are attending."
      : mine.reply === "not_attending"
        ? "You said you are not attending."
        : "You did not reply.";
  // Someone already attending keeps their reply if the event is narrowed afterwards.
  const shut = mine.notOpen !== null && mine.reply !== "attending";

  return (
    <section className="wrap band" aria-labelledby="reply">
      <h2 id="reply">
        Your <strong>reply</strong>
      </h2>
      {event.rollOpen ? (
        <>
          <p className="intro">
            {shut
              ? `${mine.notOpen} If you hold a post, say you are not attending so that it can be filled.`
              : mine.holdsAPost
                ? "You confirm against your own post. If you cannot make it, a stand-in fills it for the night."
                : "You hold no post in this event, so you attend as a spare hand and may take an empty post that is open to you."}{" "}
            You can change your reply until {closes?.day}, {closes?.utc}.
          </p>
          <ReplyForm id={event.id} reply={mine.reply} onlyDecline={shut} />
        </>
      ) : (
        <p className="intro">The roll has closed. {said} Tell the operation commander if your plans change.</p>
      )}
      {mine.place === "reserve" ? (
        <div className="standing-in">
          <p>
            Every place is taken. You are <strong>number {mine.reserveNumber} on the reserve list</strong>, and move up
            if a place opens.
          </p>
        </div>
      ) : null}
      {standingIn ? (
        <div className="standing-in">
          <p>
            {mine.standInFor ? "You are standing in as " : "You are "}
            <strong>{standingIn.title}</strong> for the night.
          </p>
          <StandInButton id={event.id}>Step back out</StandInButton>
        </div>
      ) : null}
    </section>
  );
}

const stateWords: Record<RollPost["state"], { label: string; tone: string }> = {
  confirmed: { label: "Confirmed", tone: " chip-on" },
  "stand-in": { label: "Stand-in", tone: " chip-gold" },
  empty: { label: "Empty", tone: " chip-amber" },
  waiting: { label: "Waiting for a reply", tone: "" },
};

function TheRoll({ result }: { result: Ready }) {
  const { event, roll, mine, runs, member } = result;
  const live = event.state === "announced";
  // A member with a place and no post of their own in this event, not yet placed, may take an empty post that is open to them.
  const mayVolunteer = live && mine.place === "in" && !mine.holdsAPost && !mine.standInFor && !mine.extraPost;
  // The people whoever runs the event can put in a post: spare hands first, then anyone to move up.
  const candidates = roll.spare.length + roll.inPost.length;

  return (
    <section className="wrap band" aria-labelledby="roll">
      <h2 id="roll">
        The <strong>roll</strong>
      </h2>
      <dl className="tally">
        <div>
          <dt>Posts</dt>
          <dd>{roll.posts}</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{roll.confirmed}</dd>
        </div>
        <div>
          <dt>Empty</dt>
          <dd>{roll.empty}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{roll.waiting}</dd>
        </div>
        <div>
          <dt>Spare hands</dt>
          <dd>{roll.spare.length}</dd>
        </div>
      </dl>
      <p className="roll-note">
        An empty entry post can be taken by an attending member who has no post of their own. Leadership and key posts
        are filled by the operation commander.
        {result.taking.names.length > 0 ? ` Only ${result.taking.names.join(", ")} ${result.taking.names.length === 1 ? "takes" : "take"} part, so only those posts are listed.` : ""}
        {live && runs && candidates === 0 ? " Nobody who is attending is free to stand in yet." : ""}
      </p>

      {roll.groups.map((group) => (
        <div className="unit-group" key={group.unit}>
          <h3 className="unit-group-name">{group.unit}</h3>
          <ul className="posts">
            {group.posts.map((post) => {
              const words = stateWords[post.state];
              const gap = post.state === "empty" || (post.state === "waiting" && runs);
              return (
                <li className={post.state === "empty" ? "post post-gap" : "post"} key={post.id}>
                  <span className="post-title">{post.title}</span>
                  <p className="post-state">
                    <span className={`chip${words.tone}`}>{words.label}</span>
                    {post.entry ? <span className="chip">Entry post</span> : null}
                    {post.mustFill ? <span className="chip">Must be filled</span> : null}
                  </p>
                  <p className="post-details">
                    {post.holder
                      ? `${named(post.holder, "")}: ${
                          post.holderMoved
                            ? "moved to another post for the night"
                            : post.holderOnReserve
                              ? "on the reserve list"
                              : post.holderReply === "attending"
                              ? "attending"
                              : post.holderReply === "not_attending"
                                ? "not attending"
                                : "no reply"
                        }.`
                      : "Nobody holds this post."}
                  </p>
                  {post.standIn ? (
                    <div className="post-stand-in">
                      <p>
                        Stand-in: <strong>{named(post.standIn, "")}</strong>
                        {post.standIn.id === member.id ? <span className="tag tag-you">You</span> : null}
                      </p>
                      {live && runs && post.standIn.id !== member.id ? (
                        <RemoveStandIn id={event.id} member={post.standIn.id} name={post.standIn.name} />
                      ) : null}
                    </div>
                  ) : live && gap ? (
                    runs ? (
                      candidates > 0 ? (
                        <PlaceForm id={event.id} position={post.id} post={post.title} spare={roll.spare} inPost={roll.inPost} />
                      ) : null
                    ) : post.entry ? (
                      mayVolunteer ? (
                        <StandInButton id={event.id} position={post.id}>
                          Stand in
                        </StandInButton>
                      ) : null
                    ) : (
                      <p className="post-details">The operation commander fills this post.</p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {roll.extra.length > 0 ? (
        <div className="unit-group">
          <h3 className="unit-group-name">For this event</h3>
          <ul className="posts">
            {roll.extra.map((post) => (
              <li className={post.holder ? "post" : "post post-gap"} key={post.id}>
                <span className="post-title">{post.title}</span>
                <p className="post-state">
                  <span className={post.holder ? "chip chip-on" : "chip chip-amber"}>{post.holder ? "Filled" : "Empty"}</span>
                  {post.mustFill ? <span className="chip">Must be filled</span> : null}
                  {post.openToVolunteers ? <span className="chip">Open to volunteers</span> : null}
                </p>
                {post.role ? (
                  <p className="post-details">
                    Role: {post.role.href ? <Link href={post.role.href}>{post.role.name}</Link> : post.role.name}
                  </p>
                ) : null}
                {post.holder ? (
                  <div className="post-stand-in">
                    <p>
                      <strong>{named(post.holder, "")}</strong>
                      {post.holder.id === member.id ? <span className="tag tag-you">You</span> : null}
                    </p>
                    {live && runs && post.holder.id !== member.id ? (
                      <RemoveStandIn id={event.id} member={post.holder.id} name={post.holder.name} />
                    ) : null}
                  </div>
                ) : live ? (
                  runs ? (
                    candidates > 0 ? (
                      <PlaceForm id={event.id} extra={post.id} post={post.title} spare={roll.spare} inPost={roll.inPost} />
                    ) : null
                  ) : post.openToVolunteers ? (
                    mayVolunteer ? (
                      <StandInButton id={event.id} extra={post.id}>
                        Take this post
                      </StandInButton>
                    ) : null
                  ) : (
                    <p className="post-details">The operation commander fills this post.</p>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {roll.reserve.length > 0 || (live && runs && event.places !== null && roll.withPlace.length > 0) ? (
        <div className="unit-group">
          <h3 className="unit-group-name">Reserve list</h3>
          <p className="roll-note">
            {roll.reserve.length > 0
              ? "Attending, and waiting for a place. The first on the list moves up when someone with a place drops out."
              : "Nobody is waiting for a place."}
          </p>
          {roll.reserve.length > 0 ? (
            <ol className="reserve-list">
              {roll.reserve.map((person) => (
                <li key={person.id}>
                  <span>
                    {named(person, "")}
                    {person.id === member.id ? <span className="tag tag-you">You</span> : null}
                  </span>
                  {live && runs ? <GivePlace id={event.id} member={person.id} name={person.name} /> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {live && runs && roll.withPlace.length > 0 ? <ToReserve id={event.id} people={roll.withPlace} /> : null}
        </div>
      ) : null}

      {roll.spare.length > 0 ? (
        <div className="unit-group">
          <h3 className="unit-group-name">Spare hands</h3>
          <p className="roll-note">Attending with no post on the night.</p>
          <ul className="names">
            {roll.spare.map((person) => (
              <li key={person.id}>{named(person, "")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {roll.notAttending.length > 0 ? (
        <div className="unit-group">
          <h3 className="unit-group-name">Not attending</h3>
          <ul className="names">
            {roll.notAttending.map((person) => (
              <li key={person.id}>{named(person, "")}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
