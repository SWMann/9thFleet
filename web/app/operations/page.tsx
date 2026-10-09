import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { getOperations, type Summary } from "@/lib/operations";
import { cycle, formatWhen, stateNames, weaponsName } from "@/lib/operations-form";

export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};

export default function OperationsPage() {
  return (
    <Suspense fallback={<Head lead="Reading the events." />}>
      <Operations />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: React.ReactNode }) {
  return (
    <PageHead picture="operations" title={<strong>Operations</strong>} lead={lead}>
      {children}
    </PageHead>
  );
}

async function Operations() {
  const result = await getOperations();

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="Operations are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }

  const { coming, drafts, past, mayCreate } = result;
  return (
    <>
      <Head lead="Training and operation nights: the orders, who is attending, and what was learned.">
        {mayCreate.length > 0 ? (
          <p className="actions">
            <Link className="button" href="/operations/new">
              Draft an event
            </Link>
          </p>
        ) : null}
      </Head>

      {drafts.length > 0 ? (
        <section className="wrap band" aria-labelledby="drafts">
          <h2 id="drafts">
            Your <strong>drafts</strong>
          </h2>
          <p className="intro">Only the people working on a draft can see it.</p>
          <Events events={drafts} />
        </section>
      ) : null}

      <section className="wrap band" aria-labelledby="coming">
        <h2 id="coming">
          Coming <strong>up</strong>
        </h2>
        {coming.length > 0 ? <Events events={coming} /> : <p>No event has been announced yet.</p>}
      </section>

      {past.length > 0 ? (
        <section className="wrap band" aria-labelledby="past">
          <h2 id="past">
            Past <strong>events</strong>
          </h2>
          <Events events={past} />
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="cycle">
        <h2 id="cycle">
          How every event <strong>runs</strong>
        </h2>
        <ol className="sequence">
          {cycle.map((item) => (
            <li key={item.step}>
              <h3>{item.step}</h3>
              <p>{item.detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/** A picture for each state an event is listed in, beside the state's name. */
const stateIcons: Record<Summary["state"], IconName> = { draft: "pen", announced: "flag", done: "check", cancelled: "ban" };

/** A status: its words, with a small picture in front. */
function Status({ tone, icon, children }: { tone?: string; icon: IconName; children: React.ReactNode }) {
  return (
    <span className={tone ? `chip chip-icon ${tone}` : "chip chip-icon"}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}

function Events({ events }: { events: Summary[] }) {
  return (
    <ul className="events">
      {events.map((event) => {
        const when = formatWhen(event.startsAt);
        return (
          <li className={`event event-${event.state}`} key={event.id}>
            <p className="event-kind">{event.kindName}</p>
            <h3>
              <Link href={`/operations/${event.id}`}>{event.title}</Link>
            </h3>
            {event.summary ? <p className="event-summary">{event.summary}</p> : null}
            <dl className="event-facts">
              <div>
                <dt className="with-icon">
                  <Icon name="calendar" size={14} />
                  When
                </dt>
                <dd>
                  {when.day}
                  <small>
                    {when.utc} · {when.uk}
                  </small>
                </dd>
              </div>
              <div>
                <dt className="with-icon">
                  <Icon name="people" size={14} />
                  Roll
                </dt>
                <dd>
                  {event.confirmed} of {event.posts}
                  <small>posts confirmed</small>
                </dd>
              </div>
              <div>
                <dt className="with-icon">
                  <Icon name="star" size={14} />
                  Commander
                </dt>
                <dd>{event.commander?.name ?? "Not named"}</dd>
              </div>
            </dl>
            <p className="event-chips">
              {event.state !== "announced" ? (
                <Status tone="chip-amber" icon={stateIcons[event.state]}>
                  {stateNames[event.state]}
                </Status>
              ) : null}
              {event.weaponsState ? <span className="chip">{weaponsName(event.weaponsState)}</span> : null}
              {event.repeatsWeekly ? <span className="chip">Weekly</span> : null}
              {event.manning?.state === "go" ? (
                <Status tone="chip-on" icon="check">
                  Go
                </Status>
              ) : null}
              {event.manning?.state === "no-go" ? (
                <Status tone="chip-amber" icon="warning">
                  Below its minimum
                </Status>
              ) : null}
              {event.state === "announced" ? (
                event.myPlace === "reserve" ? (
                  <Status tone="chip-gold" icon="timer">
                    You are on the reserve list
                  </Status>
                ) : event.myReply === "attending" ? (
                  <Status tone="chip-on" icon="check">
                    You are attending
                  </Status>
                ) : event.myReply === "not_attending" ? (
                  <Status icon="close">You are not attending</Status>
                ) : event.rollOpen ? (
                  <Status tone="chip-gold" icon="clock">
                    Reply needed
                  </Status>
                ) : (
                  <Status icon="lock">The roll has closed</Status>
                )
              ) : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
