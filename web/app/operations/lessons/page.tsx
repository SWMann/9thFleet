import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { Rich } from "@/components/rich/Rich";
import { getLessonsLog } from "@/lib/lessons";

export const metadata: Metadata = {
  title: "Lessons log",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Lessons <strong>log</strong>
  </>
);

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Props = { searchParams: Promise<{ type?: string }> };

export default function LessonsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Head lead="Reading the log." />}>
      <Lessons searchParams={searchParams} />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="operations" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

async function Lessons({ searchParams }: Props) {
  const [result, params] = await Promise.all([getLessonsLog(), searchParams]);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The lessons log is for the serving fleet. You will see it once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { lessons, types, member, memberNames } = result;
  const chosen = params.type && types.some((type) => type.key === params.type) ? params.type : null;
  const shown = chosen ? lessons.filter((lesson) => lesson.event.typeKey === chosen) : lessons;
  const lead =
    lessons.length === 0
      ? "Nothing yet. Whoever runs an event writes what to keep and what to change in its after-action report, and it is gathered here."
      : `What ${lessons.length === 1 ? "one after-action report says" : `${lessons.length} after-action reports say`} to keep and to change, the latest first.`;

  return (
    <>
      <Head lead={lead}>
        <p className="actions">
          <Link className="button button-quiet" href="/operations">
            Operations
          </Link>
        </p>
      </Head>
      <section className="wrap band band-last" aria-labelledby="lessons">
        <h2 id="lessons">
          By <strong>event</strong>
        </h2>
        {types.length > 1 ? (
          <nav className="filters" aria-label="Narrow the log">
            <Link className={chosen ? "chip chip-link" : "chip chip-link chip-on"} href="/operations/lessons">
              Every type
            </Link>
            {types.map((type) => (
              <Link key={type.key} className={chosen === type.key ? "chip chip-link chip-on" : "chip chip-link"} href={`/operations/lessons?type=${encodeURIComponent(type.key)}`}>
                {type.name} ({type.count})
              </Link>
            ))}
          </nav>
        ) : null}
        {shown.length === 0 ? (
          <p className="intro">No lessons of that type yet.</p>
        ) : (
          <ol className="lessons-log">
            {shown.map((lesson) => (
              <li key={lesson.event.id} className="lesson-entry">
                <div className="lesson-head">
                  <h3>
                    <Link href={`/operations/${lesson.event.id}`}>{lesson.event.title}</Link>
                  </h3>
                  <p className="lesson-facts">
                    {lesson.event.type}, {dayFormat.format(new Date(lesson.event.startsAt))}
                    {lesson.author ? `. Report by ${lesson.author}` : ""}.
                  </p>
                </div>
                <div className="lesson-sections">
                  {lesson.toKeep ? (
                    <div className="order">
                      <h4>What to keep</h4>
                      <Rich text={lesson.toKeep} day={lesson.event.startsAt} you={member.id} members={memberNames} mentions />
                    </div>
                  ) : null}
                  {lesson.toChange ? (
                    <div className="order">
                      <h4>What to change</h4>
                      <Rich text={lesson.toChange} day={lesson.event.startsAt} you={member.id} members={memberNames} mentions />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
