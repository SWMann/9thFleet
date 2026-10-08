import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Columns, Panel, Scroll, Stats } from "@/components/admin/Charts";
import { gateLogs, kindNames, periods, readLog, readVisitors, shows, type Filters, type LogLine, type Period, type Show } from "@/lib/logs";

export const metadata: Metadata = {
  title: "Logs",
  robots: { index: false, follow: false },
};

const title = <strong>Logs</strong>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function LogsPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<AdminHead current="logs" tier={null} title={title} lead="Reading the logs." />}>
      <Logs searchParams={searchParams} />
    </Suspense>
  );
}

/** What the address asks for, with anything unexpected set aside. */
function readSearch(search: Record<string, string | string[] | undefined>) {
  const one = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : "");
  const show = (shows.find((entry) => entry.key === one("show"))?.key ?? "all") as Show;
  const period = (periods.find((entry) => entry.key === one("period"))?.key ?? "all") as Period;
  const who = UUID.test(one("who")) ? one("who") : null;
  const place = (key: string) => (/^\d{1,15}$/.test(one(key)) ? Number(one(key)) : null);
  return { show, period, who, before: { audit: place("a"), activity: place("b") } };
}

async function Logs({ searchParams }: { searchParams: Search }) {
  const access = await gateLogs();
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="logs" title={title} />;

  const asked = readSearch(await searchParams);
  const head = (
    <AdminHead
      current="logs"
      tier={access.tier}
      title={title}
      lead="Every change to the fleet's records, every sign-in and sign-out, everything refused or failed, and how often each public page is read."
    />
  );

  if (asked.show === "visitors") {
    const visitors = await readVisitors();
    if (visitors.state !== "ready") return <AdminShut access={visitors} current="logs" title={title} />;
    return (
      <>
        {head}
        <section className="wrap band band-last" aria-labelledby="visitors">
          <h2 id="visitors">
            <strong>Visitors</strong>
          </h2>
          <FilterForm asked={asked} members={[]} />
          <Stats
            items={[
              { label: "Page views today", value: visitors.today.views, note: `${visitors.today.landings} visits` },
              { label: "In the last 7 days", value: visitors.week.views, note: `${visitors.week.landings} visits` },
              { label: "In the last 30 days", value: visitors.month.views, note: `${visitors.month.landings} visits` },
              {
                label: "Sign-ins not finished",
                value: visitors.signIn.cancelled + visitors.signIn.failed,
                note: `In 30 days. ${visitors.signIn.cancelled} cancelled at Discord, ${visitors.signIn.failed} failed`,
              },
            ]}
          />
          <div className="charts">
            <Panel title="Page views, day by day" note="The last 14 days. A day runs midnight to midnight, UTC." wide>
              <Columns
                caption="Page views on each of the last 14 days"
                series={visitors.days}
                noun={["page view", "page views"]}
                empty="No page has been counted in the last 14 days."
              />
            </Panel>
            <Panel title="Pages read in the last 30 days" wide>
              {visitors.pages.length === 0 ? (
                <p className="chart-empty">No page has been counted yet.</p>
              ) : (
                <Scroll label="Pages read in the last 30 days">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Page</th>
                        <th scope="col" className="number">
                          Views
                        </th>
                        <th scope="col" className="number">
                          Visits
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitors.pages.map((page) => (
                        <tr key={page.path}>
                          <th scope="row">{page.path === "/" ? "/ (the front page)" : page.path}</th>
                          <td className="number">{page.views.toLocaleString("en-GB")}</td>
                          <td className="number">{page.landings.toLocaleString("en-GB")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroll>
              )}
            </Panel>
          </div>
          <div className="prose log-note">
            <p>
              Only public pages are counted. A count is a number against a page and a day. Nothing is kept about who read it: no address, no browser, no
              cookie. A visit is a page opened fresh, counted against the page it began on, so one person reading on two days is two visits. Search engines and other robots are left out where
              they say what they are. Browsers that ask not to be tracked are not counted.
            </p>
          </div>
        </section>
      </>
    );
  }

  const filters: Filters = { show: asked.show, period: asked.period, member: asked.who, before: asked.before };
  const page = await readLog(filters);
  if (page.state !== "ready") return <AdminShut access={page} current="logs" title={title} />;

  const days = groupByDay(page.lines);
  const later = asked.before.audit !== null || asked.before.activity !== null;
  const address = (extra: Record<string, string>) => {
    const query = new URLSearchParams();
    if (asked.show !== "all") query.set("show", asked.show);
    if (asked.period !== "all") query.set("period", asked.period);
    if (asked.who) query.set("who", asked.who);
    for (const [key, value] of Object.entries(extra)) query.set(key, value);
    const text = query.toString();
    return text ? `/admin/logs?${text}` : "/admin/logs";
  };

  return (
    <>
      {head}
      <section className="wrap band band-last" aria-labelledby="lines">
        <h2 id="lines">
          {later ? "Older " : "The latest "}
          <strong>lines</strong>
        </h2>
        <FilterForm asked={asked} members={page.members} />

        {days.length === 0 ? (
          <p className="log-empty">{later ? "There is nothing older." : "Nothing matches."}</p>
        ) : (
          days.map((day) => (
            <section className="log-day" key={day.label} aria-label={day.label}>
              <h3>{day.label}</h3>
              <ol className="log">
                {day.lines.map((line) => (
                  <li key={line.key} className={line.tone ? `log-line log-${line.tone}` : "log-line"}>
                    <time dateTime={line.at}>{timeOf(line.at)}</time>
                    <span className={line.tone === "failed" ? "chip chip-amber" : "chip"}>{line.tone === "failed" ? "Failed" : kindNames[line.kind]}</span>
                    <p>
                      {line.text}.{line.detail ? <small>{line.detail}</small> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}

        <p className="actions">
          {later ? (
            <Link className="button button-quiet" href={address({})}>
              Back to the latest
            </Link>
          ) : null}
          {page.older ? (
            <Link
              className="button button-quiet"
              href={address({
                ...(page.older.audit !== null ? { a: String(page.older.audit) } : {}),
                ...(page.older.activity !== null ? { b: String(page.older.activity) } : {}),
              })}
            >
              Older lines
            </Link>
          ) : null}
        </p>
      </section>
    </>
  );
}

/** The filters, as a plain form: it works without scripts and its choices live in the address. */
function FilterForm({
  asked,
  members,
}: {
  asked: { show: Show; period: Period; who: string | null };
  members: { id: string; name: string }[];
}) {
  const visitors = asked.show === "visitors";
  return (
    <form className="filters" method="get" action="/admin/logs">
      <label>
        <span>Show</span>
        <select name="show" defaultValue={asked.show}>
          {shows.map((entry) => (
            <option value={entry.key} key={entry.key}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      {visitors ? null : (
        <>
          <label>
            <span>Who</span>
            <select name="who" defaultValue={asked.who ?? ""}>
              <option value="">Anyone</option>
              {members.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>When</span>
            <select name="period" defaultValue={asked.period}>
              {periods.map((entry) => (
                <option value={entry.key} key={entry.key}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button className="button button-small" type="submit">
        Show
      </button>
    </form>
  );
}

const dayOf = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const timeOf = (at: string) => `${clock.format(new Date(at))} UTC`;

function groupByDay(lines: LogLine[]): { label: string; lines: LogLine[] }[] {
  const days: { label: string; lines: LogLine[] }[] = [];
  for (const line of lines) {
    const label = dayOf.format(new Date(line.at));
    const last = days.at(-1);
    if (last && last.label === label) last.lines.push(line);
    else days.push({ label, lines: [line] });
  }
  return days;
}
