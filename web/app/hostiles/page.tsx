import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { Rich } from "@/components/rich/Rich";
import { RichSourcesProvider } from "@/components/rich/RichSources";
import { TabLink, TabPanel, Tabs, type TabSpec } from "@/components/Tabs";
import { kindNames, levelMeaning, levelNames, linkLabel } from "@/lib/hostile-form";
import { getHostiles, type Hostile } from "@/lib/hostiles";
import { DecideForms, KeepForms, ProposeForm, WithdrawForm } from "./HostileForms";

export const metadata: Metadata = {
  title: "Hostile list",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Hostile <strong>list</strong>
  </>
);

export default function HostilesPage() {
  return (
    <Suspense fallback={<Head lead="Reading the list." />}>
      <Hostiles />
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

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (date: string) => dayFormat.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function Hostiles() {
  const result = await getHostiles();

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="The hostile list is for the serving fleet. You will see it once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }

  const { member, command, hostile, watch, waiting, past, names, sources } = result;
  const who = (id: string | null) => (id ? (names[id] ?? "someone who has left") : "nobody on record");
  const soon = [...hostile, ...watch].filter((entry) => entry.standing.soon).length;

  const tabs: TabSpec[] = [
    { id: "hostile", label: "Hostile", icon: "ban", badge: hostile.length > 0 ? String(hostile.length) : undefined },
    { id: "watch", label: "Watch", icon: "eye", badge: watch.length > 0 ? String(watch.length) : undefined },
    { id: "forward", label: "Put forward", icon: "inbox", badge: waiting.length > 0 ? `${waiting.length} waiting` : undefined },
    ...(past.length > 0 ? [{ id: "past", label: "Past", icon: "clock" } as const] : []),
  ];

  const entry = (item: Hostile, tools: ReactNode) => (
    <li className={`hostile hostile-${item.state === "listed" && !item.standing.lapsed ? item.level : "off"}`} key={item.id} id={`entry-${item.id}`}>
      <div className="hostile-head">
        <h3>
          <span className="hostile-handle">{item.handle}</span>
          {item.name ? <span className="hostile-name">{item.name}</span> : null}
        </h3>
        <p className="hostile-chips">
          <span className="chip chip-icon">
            <Icon name={item.kind === "organisation" ? "people" : "person"} size={14} />
            {kindNames[item.kind]}
          </span>
          {item.state === "listed" && !item.standing.lapsed ? (
            <span className={`chip chip-icon ${item.level === "hostile" ? "chip-red" : "chip-amber"}`}>
              <Icon name={item.level === "hostile" ? "ban" : "eye"} size={14} />
              {levelNames[item.level]}
            </span>
          ) : null}
          {item.state === "proposed" ? (
            <span className="chip chip-icon">
              <Icon name="inbox" size={14} />
              Waiting for command
            </span>
          ) : null}
          {item.state === "declined" ? <span className="chip">Declined</span> : null}
          {item.state === "lifted" ? <span className="chip">Lifted</span> : null}
          {item.state === "listed" && item.standing.lapsed ? <span className="chip chip-amber">Lapsed</span> : null}
        </p>
      </div>

      <Rich text={item.reason} you={member.id} members={names} />

      {item.evidence.length > 0 ? (
        <ul className="hostile-evidence" aria-label={`Evidence for ${item.handle}`}>
          {item.evidence.map((address) => (
            <li key={address}>
              <Icon name="link" size={14} />
              <a href={address} rel="noopener noreferrer nofollow" target="_blank">
                {linkLabel(address)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="hostile-facts">
        <div>
          <dt>Put forward</dt>
          <dd>
            {day(item.reportedAt)}, by {who(item.reportedBy)}
          </dd>
        </div>
        {item.state === "proposed" ? (
          <div>
            <dt>Suggested</dt>
            <dd>{levelNames[item.level]}</dd>
          </div>
        ) : null}
        {item.decidedAt ? (
          <div>
            <dt>{item.state === "declined" ? "Declined" : "Listed"}</dt>
            <dd>
              {day(item.decidedAt)}, by {who(item.decidedBy)}
            </dd>
          </div>
        ) : null}
        {item.state === "listed" ? (
          <div>
            <dt>Stands</dt>
            <dd>
              {item.standing.words}
              {item.expiresOn ? <span className="aside"> to {day(item.expiresOn)}</span> : null}
            </dd>
          </div>
        ) : null}
        {item.liftedAt ? (
          <div>
            <dt>Lifted</dt>
            <dd>
              {day(item.liftedAt)}, by {who(item.liftedBy)}
            </dd>
          </div>
        ) : null}
        {item.decisionNote ? (
          <div>
            <dt>Command said</dt>
            <dd>{item.decisionNote}</dd>
          </div>
        ) : null}
      </dl>

      {tools}
    </li>
  );

  const keep = (item: Hostile) =>
    command ? (
      <KeepForms entry={{ id: item.id, handle: item.handle, kind: item.kind, name: item.name, level: item.level, reason: item.reason, evidence: item.evidence.join("\n"), lapses: item.lapses }} />
    ) : null;

  return (
    <RichSourcesProvider value={sources}>
      <Head
        lead={`${count(hostile.length, "name is", "names are")} declared hostile and ${watch.length} on watch.${command && waiting.length > 0 ? ` ${count(waiting.length, "name waits", "names wait")} for your decision.` : ""}`}
      />

      <Tabs label="Parts of the hostile list" tabs={tabs}>
        <TabPanel id="hostile">
          <div className="wrap band tab-band">
            <h2 className="tab-title" id="hostile-title">
              Declared hostile
            </h2>
            <p className="intro">
              {levelMeaning.hostile} The commander&apos;s weapons state and the rules of engagement in the{" "}
              <Link href="/standards">standards</Link> still apply. This list is for the fleet, and for the game only.
            </p>
            {command && soon > 0 ? (
              <p className="notice">
                <Icon name="clock" size={16} />
                {count(soon, "entry lapses", "entries lapse")} within 14 days. Renew what should stand.
              </p>
            ) : null}
            {hostile.length > 0 ? (
              <ul className="hostiles">{hostile.map((item) => entry(item, keep(item)))}</ul>
            ) : (
              <p className="empty">Nobody is declared hostile.</p>
            )}
          </div>
        </TabPanel>

        <TabPanel id="watch">
          <div className="wrap band tab-band">
            <h2 className="tab-title" id="watch-title">
              On watch
            </h2>
            <p className="intro">{levelMeaning.watch} A name on watch lapses after 90 days unless command renews it.</p>
            {watch.length > 0 ? <ul className="hostiles">{watch.map((item) => entry(item, keep(item)))}</ul> : <p className="empty">Nobody is on watch.</p>}
          </div>
        </TabPanel>

        <TabPanel id="forward">
          <div className="wrap band tab-band">
            <h2 className="tab-title" id="forward-title">
              {command ? "Waiting for your decision" : "Names you have put forward"}
            </h2>
            {waiting.length > 0 ? (
              <ul className="hostiles">
                {waiting.map((item) =>
                  entry(
                    item,
                    <>
                      {command ? <DecideForms id={item.id} handle={item.handle} suggested={item.level} /> : null}
                      {item.mine ? <WithdrawForm id={item.id} handle={item.handle} /> : null}
                    </>,
                  ),
                )}
              </ul>
            ) : (
              <p className="empty">{command ? "No name is waiting." : "You have no name waiting with command."}</p>
            )}

            <h2 className="tab-title tab-title-next" id="propose-title">
              Put a name forward
            </h2>
            <p className="intro">
              Any serving member may. Nothing is on the list until command says so
              {past.length > 0 ? (
                <>
                  , and what command answered is under <TabLink to="past">Past</TabLink>
                </>
              ) : null}
              .
            </p>
            <ProposeForm command={command} />
          </div>
        </TabPanel>

        {past.length > 0 ? (
          <TabPanel id="past">
            <div className="wrap band tab-band">
              <h2 className="tab-title" id="past-title">
                Declined, lifted and lapsed
              </h2>
              <p className="intro">
                {command
                  ? "Off the list. A lapsed entry can be renewed. A name that was declined or lifted is put forward again to reopen it."
                  : "Names you put forward that are no longer on the list, with what command answered."}
              </p>
              <ul className="hostiles">{past.map((item) => entry(item, item.state === "listed" ? keep(item) : null))}</ul>
            </div>
          </TabPanel>
        ) : null}
      </Tabs>
    </RichSourcesProvider>
  );
}
