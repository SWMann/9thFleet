import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { hasReading, ReadingList } from "@/components/manual/Reading";
import { PageHead } from "@/components/PageHead";
import { Pane, Panes } from "@/components/Pane";
import { Icon } from "@/components/Icon";
import { TabLink, TabPanel, Tabs, type TabSpec } from "@/components/Tabs";
import { YourTime } from "@/components/YourTime";
import { shortfall } from "@/lib/manning";
import { getOperation, type FleetEvent, type Operation, type Person, type RollPost, type UnitTask } from "@/lib/operations";
import { levelIcons, taskLevels } from "@/lib/tasks";
import { formatWhen, hLabel, outcomeNames, returnedNames, serviceNames, stateNames, weapons, weaponsName } from "@/lib/operations-form";
import {
  CopyButton,
  GivePlace,
  MoveForms,
  OpforAddForm,
  OpforMemberButtons,
  OpforPlanForm,
  PlaceForm,
  RemoveStandIn,
  ReplyForm,
  ReportForm,
  ReturnForm,
  StandInButton,
  ToReserve,
} from "../OpsForms";
import { AcknowledgeButton, AmendmentForm, OutcomesForm, PlanEditor, SignOffForm } from "../PlanForms";
import { LevelChip, PassDown } from "../TaskForms";

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
      slim
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

/** What someone is told about a task whose words are withheld from them. */
function heldLine(task: UnitTask): string {
  if (task.level === "commander") return `This task is held by the commander of ${task.unit.name}.`;
  if (task.level === "leaders") return `This task is for the leaders of ${task.unit.name}.`;
  return `This task is for ${task.unit.name} only.`;
}

/** When the roll closes, or that it has. */
function rollLine(event: FleetEvent): string {
  if (event.state === "draft") return "Opens when the event is announced";
  const closes = event.rollClosesAt ? formatWhen(event.rollClosesAt) : null;
  return closes && event.rollOpen ? `Closes ${closes.day}, ${closes.utc}` : "Closed";
}

/**
 * An event, as tabs of cards. Every tab is on the page, and the address says
 * which one is shown, so a link can open the roll or the orders directly.
 */
async function Event({ params }: { params: Props["params"] }) {
  const { id } = await params;
  const result = await getOperation(id);

  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head title="Event" lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") return <Head title="Event" lead="Operations are for the serving fleet." />;
  if (result.state === "not-found") notFound();

  const { event, orders, sections, runs, edits, report, manning, roll, plan, amendments, records, passed, signOff } = result;
  // What the report records beyond its words: enough to show it even before the words are written.
  const recorded = Object.keys(records.outcomes).length > 0 || records.losses.length > 0 || records.mentions.length > 0;
  const open_to = openTo(event);
  const latest = amendments[0] ?? null;
  // Everyone who said they are attending is asked to acknowledge the latest amendment.
  const toAcknowledge =
    event.state === "announced" && latest !== null && result.mine.reply === "attending" && (result.acknowledged ?? 0) < latest.number
      ? latest.number
      : null;
  // Someone who may draft this type of event may draft another like it.
  const mayCopy = result.mayCreate.some((type) => type.key === event.kind);
  const when = formatWhen(event.startsAt);
  const open = event.state === "draft" || event.state === "announced";
  const weaponsMeaning = weapons.find((entry) => entry.key === event.weaponsState)?.meaning;
  const begun = event.started && event.state !== "cancelled";
  const making = runs && begun;
  const signingOff = Boolean(event.teaches) && begun && (signOff !== null || passed.length > 0);
  const reading = (report !== null || recorded) && !making;
  const running = (runs || edits) && open;
  const callsigns = plan.elements.some((element) => element.callsign) || result.tasks.some((task) => task.callsign);
  const withheld = result.tasks.filter((task) => task.body === null).length;
  const mine = result.tasks.filter((task) => task.mine);
  const beside = plan.objectives.length > 0 || plan.timings.length > 0 || plan.ships.length > 0 || plan.nets.length > 0 || callsigns;

  const tabs: TabSpec[] = [
    { id: "overview", label: "Overview", icon: "target" },
    { id: "orders", label: "Orders", icon: "book" },
    { id: "tasks", label: "Tasks", icon: "flag", badge: withheld > 0 ? `${withheld} withheld` : undefined },
    ...(event.state !== "draft" ? [{ id: "roll", label: "Roll", icon: "people" } as const] : []),
    { id: "report", label: "Report", icon: "pen" },
    ...(result.opfor ? [{ id: "opfor", label: "Opposing force", icon: "shield" } as const] : []),
    ...(running ? [{ id: "run", label: "Run it", icon: "anchor" } as const] : []),
  ];

  return (
    <>
      <Head title={event.title} lead={event.summary || event.kindName}>
        <p className="chips">
          <span className="chip chip-gold">{event.kindName}</span>
          {event.state !== "announced" ? <span className="chip chip-amber">{stateNames[event.state]}</span> : null}
          {event.weaponsState ? <span className="chip">{weaponsName(event.weaponsState)}</span> : null}
          {event.repeatsWeekly ? <span className="chip">Weekly</span> : null}
        </p>
        <ul className="head-facts">
          <li>
            <span>When</span>
            <strong>
              {when.day}, {when.utc}
            </strong>
          </li>
          {event.musterAt ? (
            <li>
              <span>Muster</span>
              <strong>{event.musterAt}</strong>
            </li>
          ) : null}
          <li>
            <span>Commander</span>
            <strong>{named(event.commander, "Not named")}</strong>
          </li>
          <li>
            <span>Roll</span>
            <strong>{rollLine(event)}</strong>
          </li>
        </ul>
        {edits && open ? (
          <p className="actions">
            <Link className="button button-quiet" href={`/operations/${event.id}/edit`}>
              Change the details and orders
            </Link>
          </p>
        ) : null}
      </Head>

      <Tabs label="Parts of this event" tabs={tabs}>
        <TabPanel id="overview">
          <div className="wrap band tab-band">
            <Panes>
              {event.state === "draft" ? (
                <Pane id="draft" icon="pen" title="A draft">
                  <p>This is a draft. Only you, its commander and command can see it.</p>
                  <p>It is announced from the Run it tab, once its orders are written.</p>
                </Pane>
              ) : null}

              {event.state === "announced" ? <YourReply result={result} /> : null}

              {manning ? (
                <Pane id="manning" icon="people" title="Go or no-go">
                  <div className={`manning manning-${manning.state}`}>
                    <p className="manning-word">{manningWords[manning.state]}</p>
                    <p>
                      {manning.state === "go"
                        ? `${manning.attending} attending${manning.minimum !== null ? `, against a minimum of ${manning.minimum}` : ""}, and every post that must be filled has someone in it.`
                        : shortfall(manning)}{" "}
                      {manning.state === "short"
                        ? "Members can still reply."
                        : manning.state === "no-go"
                          ? "The roll has closed. Whether it goes ahead is the operation commander's decision."
                          : ""}
                    </p>
                  </div>
                </Pane>
              ) : null}

              {latest ? (
                <Pane id="latest-amendment" icon="radio" title="Latest amendment">
                  <p className="amendment-head">
                    <strong>Amendment {latest.number}</strong>
                    <span>
                      {formatWhen(latest.issuedAt).day}, {formatWhen(latest.issuedAt).utc}
                    </span>
                  </p>
                  <p className="order-text">{latest.body}</p>
                  {toAcknowledge !== null ? (
                    <div className="standing-in">
                      <p>It changes the orders. Read it, then acknowledge it.</p>
                      <AcknowledgeButton id={event.id} number={toAcknowledge} />
                    </div>
                  ) : result.acknowledged !== null && result.acknowledged === latest.number ? (
                    <p className="roll-note">You have acknowledged amendment {latest.number}.</p>
                  ) : null}
                </Pane>
              ) : null}

              {mine.length > 0 ? (
                <Pane id="your-task" icon="flag" title={mine.length === 1 ? "Your task" : "Your tasks"}>
                  {mine.map((task) => (
                    <div className="your-task" key={task.id}>
                      <p className="your-task-head">
                        <strong>{task.unit.name}</strong>
                        <LevelChip level={task.level} />
                      </p>
                      {task.body !== null ? (
                        <p className="order-text">{task.body}</p>
                      ) : (
                        <p className="unit-task-held">
                          <Icon name="lock" size={18} />
                          <span>{heldLine(task)}</span>
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="pane-more">
                    <TabLink to="tasks">Every unit&apos;s task</TabLink>
                  </p>
                </Pane>
              ) : null}

              {result.myReturn && !runs ? (
                <Pane id="returned" icon="checks" title="Your attendance">
                  <p>
                    The operation commander recorded you as <strong>{returnedNames[result.myReturn].toLowerCase()}</strong>. Only
                    you, staff and whoever ran the event can see this.
                  </p>
                </Pane>
              ) : null}

              <Pane id="glance" icon="calendar" title="At a glance" wide>
                <dl className="facts">
                  <div>
                    <dt>When</dt>
                    <dd>
                      {when.day}, {when.utc}
                      <YourTime iso={event.startsAt} fallback={when.uk} withDay />
                    </dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>{length(event.durationMinutes)}</dd>
                  </div>
                  {event.musterAt ? (
                    <div>
                      <dt>Muster at</dt>
                      <dd>{event.musterAt}</dd>
                    </div>
                  ) : null}
                  {event.area ? (
                    <div>
                      <dt>Area</dt>
                      <dd>{event.area}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Roll</dt>
                    <dd>{rollLine(event)}</dd>
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
                  {event.teaches ? (
                    <div>
                      <dt>Teaches</dt>
                      <dd>
                        {event.teaches.name}
                        <span className="aside">An instructor signs off who passes</span>
                      </dd>
                    </div>
                  ) : null}
                  {event.repeatsWeekly ? (
                    <div>
                      <dt>Repeats</dt>
                      <dd>
                        Weekly
                        <span className="aside">{open ? "Closing it drafts next week's" : "Closing it drafted next week's"}</span>
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
                {event.state === "announced" || mayCopy ? (
                  <div className="glance-actions">
                    {/* A file, not a page: the browser saves it, so it is a plain link. A draft's date is not settled, so it has none. */}
                    {event.state === "announced" ? (
                      <a className="button button-quiet" href={`/operations/${event.id}/calendar`} download>
                        Add to calendar
                      </a>
                    ) : null}
                    {mayCopy ? <CopyButton id={event.id} /> : null}
                  </div>
                ) : null}
              </Pane>

              {hasReading(event.reading) ? (
                <Pane id="reading" icon="book" title="Read before the night" wide>
                  <ReadingList addresses={event.reading} />
                </Pane>
              ) : null}
            </Panes>
          </div>
        </TabPanel>

        <TabPanel id="orders">
          <div className="wrap band tab-band">
            <h2 className="tab-title" id="orders">
              The orders
            </h2>
            <div className={beside ? "orders orders-split" : "orders"}>
              <div className="orders-main">
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
              {beside ? (
                <div className="orders-side">
                  <PlanBeside result={result} />
                </div>
              ) : null}
            </div>

            {amendments.length > 0 ? (
              <div className="amendments">
                <h3 className="unit-group-name">Amendments</h3>
                <ol className="amendment-list" reversed>
                  {amendments.map((amendment) => {
                    const issued = formatWhen(amendment.issuedAt);
                    return (
                      <li key={amendment.number} value={amendment.number}>
                        <p className="amendment-head">
                          <strong>Amendment {amendment.number}</strong>
                          <span>
                            {issued.day}, {issued.utc}, by {named(amendment.issuedBy, "a member who has left")}
                          </span>
                        </p>
                        <p className="order-text">{amendment.body}</p>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
          </div>
        </TabPanel>

        <TabPanel id="tasks">
          <div className="wrap band tab-band">
            <h2 className="tab-title" id="tasks">
              Tasks
            </h2>
            {result.tasks.length > 0 || plan.elements.length > 0 ? (
              <div className="tasks-split">
                <div className="task-list">
                  {result.tasks.map((task) => (
                    <article
                      className={["unit-task", task.body === null ? "unit-task-withheld" : "", task.unit.nested ? "unit-task-nested" : ""].filter(Boolean).join(" ")}
                      key={task.id}
                    >
                      <header className="unit-task-head">
                        <h3>
                          {task.unit.name}
                          <span className="aside">
                            {task.unit.kind[0]?.toUpperCase()}
                            {task.unit.kind.slice(1)}
                            {task.callsign ? `, callsign ${task.callsign}` : ""}
                          </span>
                          {task.mine ? <span className="tag tag-you">Yours</span> : null}
                        </h3>
                        <LevelChip level={task.level} />
                      </header>
                      {task.body !== null ? (
                        <p className="order-text">{task.body}</p>
                      ) : (
                        <p className="unit-task-held">
                          <Icon name="lock" size={18} />
                          <span>{heldLine(task)}</span>
                        </p>
                      )}
                      {task.passTo.length > 0 ? <PassDown id={event.id} task={task.id} unit={task.unit.name} to={task.passTo} /> : null}
                    </article>
                  ))}
                  {plan.elements.map((element) => (
                    <article className="unit-task" key={element.id}>
                      <header className="unit-task-head">
                        <h3>
                          {element.name}
                          {element.callsign ? <span className="aside">Callsign {element.callsign}</span> : null}
                        </h3>
                        <LevelChip level="everyone" />
                      </header>
                      <p className={element.task ? "order-text" : "order-none"}>{element.task || "No task given yet."}</p>
                    </article>
                  ))}
                </div>
                <aside className="pane task-key" aria-labelledby="task-key">
                  <h3 className="pane-title" id="task-key">
                    <Icon name="eye" size={18} />
                    <span>Who reads a task</span>
                  </h3>
                  <ul>
                    {taskLevels.map((level) => (
                      <li key={level.key} className={`level-${level.key}`}>
                        <Icon name={levelIcons[level.key]} size={18} />
                        <span>
                          <strong>{level.label}</strong>
                          {level.about}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p>
                    The commanders of the units above always read a task. So do command and whoever runs the event.
                    {open ? " Every task opens to all once the event is closed." : ""}
                  </p>
                </aside>
              </div>
            ) : (
              <p className="tab-none">No unit has been given a task yet.</p>
            )}
          </div>
        </TabPanel>

        {event.state !== "draft" ? (
          <TabPanel id="roll">
            <div className="wrap band tab-band">
              <TheRoll result={result} />
            </div>
          </TabPanel>
        ) : null}

        <TabPanel id="report">
          <div className="wrap band tab-band">
            <Panes>
              {making ? (
                <>
                  <Pane id="return" icon="checks" title="The attendance return" wide>
                    <p>
                      Mark who was there. It feeds each member&apos;s activity record
                      {event.state === "done" ? "." : ", and making it closes the event."} A member sees only their own line.
                    </p>
                    {result.returns.length > 0 ? (
                      <ReturnForm id={event.id} lines={result.returns} done={event.state === "done"} />
                    ) : (
                      <p>Nobody is on the roll.</p>
                    )}
                  </Pane>
                  <Pane id="file" icon="pen" title="The after-action report" wide>
                    <p>Due within 48 hours. The fleet reads it, and its lessons become changes to procedure.</p>
                    <ReportForm id={event.id} report={report} />
                  </Pane>
                  {plan.objectives.length > 0 ? (
                    <div className="plan-part pane-wide">
                      <h3 className="plan-part-title">How each objective turned out</h3>
                      <OutcomesForm id={event.id} objectives={plan.objectives} outcomes={records.outcomes} />
                    </div>
                  ) : null}
                  <PlanEditor
                    id={event.id}
                    part="losses"
                    rows={records.losses.map((loss) => ({ id: loss.id, values: { item: loss.item, quantity: String(loss.quantity), note: loss.note } }))}
                  />
                  <PlanEditor
                    id={event.id}
                    part="mentions"
                    rows={records.mentions.map((mention) => ({
                      id: mention.id,
                      values: { member_id: mention.person.id, member_name: named(mention.person, ""), citation: mention.citation },
                    }))}
                    members={result.present
                      .filter((person) => !records.mentions.some((mention) => mention.person.id === person.id))
                      .map((person) => ({ value: person.id, label: named(person, "") }))}
                  />
                </>
              ) : null}

              {signingOff && event.teaches ? (
                <Pane id="sign-off" icon="star" title="Signed off" wide>
                  <p>
                    This event teaches {event.teaches.name}.{" "}
                    {passed.length > 0
                      ? `Signed off here: ${passed.map((person) => named(person, "")).join(", ")}.`
                      : "Nobody has been signed off yet."}
                  </p>
                  {signOff ? (
                    signOff.candidates.length > 0 ? (
                      <SignOffForm id={event.id} qualification={signOff.qualification.name} candidates={signOff.candidates} />
                    ) : (
                      <p>Nobody else is down as having been there.</p>
                    )
                  ) : null}
                </Pane>
              ) : null}

              {reading ? (
                <Pane id="report" icon="pen" title="After-action report" wide>
                  <p>
                    {report
                      ? `Filed by ${named(report.author, "a member who has left")} on ${formatWhen(report.filedAt).day}.`
                      : "The report's words are not written yet."}
                  </p>
                  <div className="orders">
                    {report ? (
                      <div className="order">
                        <h3>What happened</h3>
                        <p className="order-text">{report.whatHappened}</p>
                      </div>
                    ) : null}
                    {plan.objectives.some((objective) => records.outcomes[objective.id]) ? (
                      <div className="order">
                        <h3>Objectives</h3>
                        <ol className="plan-list outcome-list">
                          {plan.objectives.map((objective) => {
                            const outcome = records.outcomes[objective.id];
                            return (
                              <li key={objective.id}>
                                {objective.title}
                                <span className={outcome ? `chip chip-outcome-${outcome.outcome}` : "chip"}>
                                  {outcome ? outcomeNames[outcome.outcome] : "Not answered"}
                                </span>
                                {outcome?.note ? <small>{outcome.note}</small> : null}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : null}
                    {records.losses.length > 0 ? (
                      <div className="order">
                        <h3>Losses</h3>
                        <table className="plan-table">
                          <thead>
                            <tr>
                              <th scope="col">What was lost</th>
                              <th scope="col">How many</th>
                              <th scope="col">Note</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.losses.map((loss) => (
                              <tr key={loss.id}>
                                <th scope="row">{loss.item}</th>
                                <td>{loss.quantity}</td>
                                <td>{loss.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {records.mentions.length > 0 ? (
                      <div className="order">
                        <h3>Mentions</h3>
                        <dl className="plan-tasks">
                          {records.mentions.map((mention) => (
                            <div key={mention.id}>
                              <dt>
                                {named(mention.person, "")}
                                {mention.person.id === result.member.id ? <span className="tag tag-you">You</span> : null}
                              </dt>
                              <dd className="order-text">{mention.citation}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                    {report?.toKeep ? (
                      <div className="order">
                        <h3>What to keep</h3>
                        <p className="order-text">{report.toKeep}</p>
                      </div>
                    ) : null}
                    {report?.toChange ? (
                      <div className="order">
                        <h3>What to change</h3>
                        <p className="order-text">{report.toChange}</p>
                      </div>
                    ) : null}
                  </div>
                </Pane>
              ) : null}

              {!making && !signingOff && !reading ? (
                <Pane id="no-report" icon="pen" title="The report" wide>
                  <p>
                    {event.state === "cancelled"
                      ? "This event was cancelled, so it has no report."
                      : event.started
                        ? "No report has been filed yet. It is due within 48 hours of the event."
                        : "The report opens once the event has started. Whoever runs it makes the attendance return and files the report here."}
                  </p>
                </Pane>
              ) : null}
            </Panes>
          </div>
        </TabPanel>

        {result.opfor ? (
          <TabPanel id="opfor">
            <div className="wrap band tab-band">
              <OpposingForce result={result} open={open} />
            </div>
          </TabPanel>
        ) : null}

        {running ? (
          <TabPanel id="run">
            <div className="wrap band tab-band">
              <Panes>
                <Pane id="running" icon="anchor" title="Decisions" wide={!(runs && event.state === "announced")}>
                  <p>
                    {event.state === "draft"
                      ? "Announce it when its details and orders are ready. Until then nobody else is told."
                      : "You run this event, so you keep its orders, fill the gaps on the roll and make the return."}
                  </p>
                  <MoveForms
                    id={event.id}
                    state={event.state as "draft" | "announced"}
                    title={event.title}
                    // The link to change it is under the title, where it can be reached from every tab.
                    editHref={null}
                    mayCancel={runs || event.state === "draft"}
                    approval={event.approval}
                    needsApproval={event.needsApproval}
                    isCommand={result.isCommand}
                  />
                </Pane>
                {runs && event.state === "announced" ? (
                  <Pane id="amend" icon="radio" title="Amend the orders">
                    <AmendmentForm id={event.id} />
                    {latest !== null ? (
                      <p className="roll-note">
                        {result.awaiting.length > 0
                          ? `Not yet acknowledged amendment ${latest.number}: ${result.awaiting.map((person) => named(person, "")).join(", ")}.`
                          : `Everyone attending has acknowledged amendment ${latest.number}.`}
                      </p>
                    ) : null}
                  </Pane>
                ) : null}
              </Panes>
            </div>
          </TabPanel>
        ) : null}
      </Tabs>
    </>
  );
}

/**
 * The parts of the plan that sit beside the orders: the objectives, the
 * timeline, the ships and the comms plan. Each is left out when the event has none.
 */
function PlanBeside({ result }: { result: Ready }) {
  const { plan } = result;
  const callsigns = [
    ...result.tasks.filter((task) => task.callsign).map((task) => ({ id: task.id, name: task.unit.name, callsign: task.callsign })),
    ...plan.elements.filter((element) => element.callsign).map((element) => ({ id: element.id, name: element.name, callsign: element.callsign })),
  ];
  return (
    <>
      {plan.objectives.length > 0 ? (
        <div className="order">
          <h3>Objectives</h3>
          <ol className="plan-list">
            {plan.objectives.map((objective) => (
              <li key={objective.id}>{objective.title}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {plan.timings.length > 0 ? (
        <div className="order">
          <h3>Timeline</h3>
          <table className="plan-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              {plan.timings.map((timing) => {
                const at = formatWhen(timing.at);
                return (
                  <tr key={timing.id}>
                    <th scope="row">
                      {at.utc}
                      <YourTime iso={timing.at} fallback={at.uk} />
                      <small>{hLabel(timing.offsetMinutes)}</small>
                    </th>
                    <td>{timing.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.ships.length > 0 ? (
        <div className="order">
          <h3>Ships</h3>
          <table className="plan-table">
            <thead>
              <tr>
                <th scope="col">Ship</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {plan.ships.map((ship) => (
                <tr key={ship.id}>
                  <th scope="row">{ship.ship}</th>
                  <td>{ship.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.nets.length > 0 || callsigns.length > 0 ? (
        <div className="order">
          <h3>Comms plan</h3>
          {plan.nets.length > 0 ? (
            <table className="plan-table">
              <thead>
                <tr>
                  <th scope="col">Net</th>
                  <th scope="col">What it is for</th>
                  <th scope="col">Who controls it</th>
                </tr>
              </thead>
              <tbody>
                {plan.nets.map((net) => (
                  <tr key={net.id}>
                    <th scope="row">{net.name}</th>
                    <td>{net.purpose}</td>
                    <td>{net.controller}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {callsigns.length > 0 ? (
            <table className="plan-table">
              <thead>
                <tr>
                  <th scope="col">Unit or element</th>
                  <th scope="col">Callsign</th>
                </tr>
              </thead>
              <tbody>
                {callsigns.map((element) => (
                  <tr key={element.id}>
                    <th scope="row">{element.name}</th>
                    <td>{element.callsign}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The opposing force, for the only people who are shown it: command, and the
 * members on it. Command names its members. Command and whoever leads it write its plan.
 */
function OpposingForce({ result, open }: { result: Ready; open: boolean }) {
  const { event } = result;
  const opfor = result.opfor!;
  return (
    <section aria-labelledby="opfor">
      <h2 className="tab-title" id="opfor">
        Opposing force
      </h2>
      <p className="tab-lead">
        {opfor.mine ? "You are on the opposing force for this event. " : ""}
        Only command and the members of the opposing force can see this. The side being exercised sees neither the plan
        nor who is on it, and that includes the event&apos;s commander.
      </p>
      <Panes>
        <Pane id="opfor-roll" icon="people" title="Who is on it">
          {opfor.members.length > 0 ? (
            <ul className="opfor-roll">
              {opfor.members.map((entry) => (
                <li key={entry.person.id}>
                  <span>
                    {named(entry.person, "")}
                    {entry.leads ? <span className="chip chip-gold">Leads</span> : null}
                    {entry.person.id === result.member.id ? <span className="tag tag-you">You</span> : null}
                  </span>
                  {opfor.names && open ? (
                    <OpforMemberButtons id={event.id} member={entry.person.id} name={entry.person.name} leads={entry.leads} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="roll-note">Nobody has been named yet.</p>
          )}
          {opfor.names && open ? (
            <>
              <p className="roll-note">
                Naming a member takes them off this event&apos;s roll. Whoever leads the opposing force can write its plan.
              </p>
              <OpforAddForm id={event.id} candidates={opfor.candidates} />
            </>
          ) : null}
        </Pane>
        <Pane id="opfor-plan" icon="flag" title="Its plan">
          {opfor.writes && open ? (
            <OpforPlanForm id={event.id} plan={opfor.plan} />
          ) : opfor.plan ? (
            <div className="orders">
              <div className="order">
                <p className="order-text">{opfor.plan}</p>
              </div>
            </div>
          ) : (
            <p className="roll-note">No plan has been written yet.</p>
          )}
        </Pane>
      </Panes>
    </section>
  );
}

function YourReply({ result }: { result: Ready }) {
  const { event, mine, roll } = result;
  // Someone on the opposing force is not on the roll.
  if (result.opfor?.mine) {
    return (
      <Pane id="reply" icon="checks" title="Your reply">
        <p>
          You are on the opposing force for this event, so you are not on its roll and have nothing to reply to. Whoever
          makes the attendance return records that you were there.
        </p>
      </Pane>
    );
  }
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
    <Pane id="reply" icon="checks" title="Your reply">
      {event.rollOpen ? (
        <>
          <p>
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
        <p>The roll has closed. {said} Tell the operation commander if your plans change.</p>
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
    </Pane>
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
    <>
      <h2 className="tab-title" id="roll">
        The roll
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
    </>
  );
}
