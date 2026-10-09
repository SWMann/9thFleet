import type { Metadata } from "next";
import { Suspense } from "react";
import { Pane, Panes } from "@/components/Pane";
import { TabPanel, Tabs, type TabSpec } from "@/components/Tabs";
import { toFields } from "@/lib/operations-form";
import type { Plan } from "@/lib/operations";
import { deleteDraft } from "../../actions";
import { ForceChart } from "../../ForceChart";
import { EventForm, ExtraPostForm, KeyPostsForm, OrdersForm, RemoveExtraPost } from "../../OpsForms";
import { PlanEditor, ReadingForm, type PlanRow } from "../../PlanForms";
import { RemoveTask, TaskForm } from "../../TaskForms";
import { EditHead, openForEdit } from "./frame";

export const metadata: Metadata = {
  title: "Change an event",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]/edit">;

export default function EditEventPage({ params }: Props) {
  return (
    <Suspense fallback={<EditHead title="Event" lead="Reading the event." />}>
      <EditEvent params={params} />
    </Suspense>
  );
}

const tabs: TabSpec[] = [
  { id: "details", label: "Details", icon: "calendar" },
  { id: "forces", label: "Forces", icon: "ship" },
  { id: "orders", label: "Orders", icon: "book" },
  { id: "tasks", label: "Tasks", icon: "flag" },
];

/** Each of the plan's lists as its editor takes it: every value as the text a form holds. */
function rowsOf(plan: Plan): Record<keyof Plan, PlanRow[]> {
  return {
    objectives: plan.objectives.map((entry) => ({ id: entry.id, values: { title: entry.title } })),
    elements: plan.elements.map((entry) => ({ id: entry.id, values: { name: entry.name, callsign: entry.callsign, task: entry.task } })),
    // A timing is entered as its time of day in UTC.
    timings: plan.timings.map((entry) => ({ id: entry.id, values: { time: toFields(entry.at).time, label: entry.label } })),
    ships: plan.ships.map((entry) => ({ id: entry.id, values: { ship: entry.ship, note: entry.note } })),
    nets: plan.nets.map((entry) => ({ id: entry.id, values: { name: entry.name, purpose: entry.purpose, controller: entry.controller } })),
  };
}

/**
 * Changing an event, as tabs of cards. Every tab is on the page at once, so
 * what is typed on one is still there after a look at another. Each card saves by itself.
 */
async function EditEvent({ params }: { params: Props["params"] }) {
  const opened = await openForEdit((await params).id);
  if ("shut" in opened) return opened.shut;
  const { event, people, mayCreate, types, choices, taking, roll, orders, sections, plan, tasks, taskUnits } = opened.result;
  const rows = rowsOf(plan);
  const { date, time } = toFields(event.startsAt);

  return (
    <>
      <EditHead id={event.id} title={event.title} lead="Its details, the force it uses, its orders and its tasks. Each card saves by itself." />

      <Tabs label="Parts of the editor" tabs={tabs}>
        <TabPanel id="details">
          <div className="wrap band tab-band">
            <EventForm
              event={{
                id: event.id,
                kind: event.kind,
                title: event.title,
                summary: event.summary,
                date,
                time,
                duration: event.durationMinutes,
                commander: event.commander?.id ?? "",
                second: event.second?.id ?? "",
                observer: event.observer?.id ?? "",
                weaponsState: event.weaponsState ?? "",
                pveFallback: event.pveFallback,
                repeatsWeekly: event.repeatsWeekly,
                openToRecruits: event.openToRecruits,
                openToService: event.openToService ?? "",
                requiresQualification: event.requires?.id ?? "",
                places: event.places === null ? "" : String(event.places),
                minimumAttending: event.minimumAttending === null ? "" : String(event.minimumAttending),
                musterAt: event.musterAt,
                area: event.area,
                teachesQualification: event.teaches?.id ?? "",
              }}
              // Someone changing an event they could not have drafted keeps its type on the list.
              types={types.filter((type) => type.key === event.kind || mayCreate.some((own) => own.key === type.key))}
              people={people}
              qualifications={choices.qualifications}
            />
            {event.state === "draft" ? (
              <div className="panes panes-after">
                <Pane id="scrap" icon="close" title="Scrap the draft" wide>
                  <details className="confirm">
                    <summary className="button button-quiet">Delete this draft</summary>
                    <form action={deleteDraft} className="confirm-body">
                      <input type="hidden" name="id" value={event.id} />
                      <p>Delete {event.title}? Nobody else has seen it, and it cannot be brought back.</p>
                      <button className="button" type="submit">
                        Yes, delete it
                      </button>
                    </form>
                  </details>
                </Pane>
              </div>
            ) : null}
          </div>
        </TabPanel>

        <TabPanel id="forces">
          <div className="wrap band tab-band">
            {choices.force ? <ForceChart id={event.id} fleet={choices.force} chosen={taking.units} /> : null}
            <Panes>
              <Pane id="key-posts" icon="star" title="Key posts">
                <KeyPostsForm id={event.id} groups={choices.posts} chosen={taking.keyPosts} />
              </Pane>
              <Pane id="extra-posts" icon="person" title="Posts for this event only" wide>
                <div className="extra-posts">
                  <p className="hint">
                    A post the order of battle does not have, for this one night: a range safety officer, an umpire,
                    trainees. Each is listed on the roll, where it is filled like any other post.
                  </p>
                  {roll.extra.length > 0 ? (
                    <ul>
                      {roll.extra.map((post) => (
                        <li key={post.id}>
                          <span>
                            {post.title}
                            <small>
                              {[post.role?.name, post.mustFill ? "must be filled" : null, post.openToVolunteers ? "open to volunteers" : null]
                                .filter(Boolean)
                                .join(", ")}
                            </small>
                          </span>
                          <RemoveExtraPost id={event.id} post={post.id} title={post.title} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <ExtraPostForm id={event.id} roles={choices.roles} />
              </Pane>
            </Panes>
          </div>
        </TabPanel>

        <TabPanel id="orders">
          <div className="wrap band tab-band">
            {event.state === "announced" ? (
              <p className="tab-lead">
                This event is announced. If you change its orders or its plan, issue an amendment from the event&apos;s
                page, so that everyone attending is told what changed and can acknowledge it.
              </p>
            ) : null}
            <Panes>
              <Pane id="orders" icon="book" title="The orders" wide>
                <OrdersForm id={event.id} orders={orders} sections={sections} />
              </Pane>
              <PlanEditor id={event.id} part="objectives" rows={rows.objectives} />
              <PlanEditor id={event.id} part="timings" rows={rows.timings} />
              <PlanEditor id={event.id} part="ships" rows={rows.ships} />
              <PlanEditor id={event.id} part="nets" rows={rows.nets} />
              <Pane id="pane-reading" icon="book" title="Reading" wide>
                <ReadingForm id={event.id} reading={event.reading} />
              </Pane>
            </Panes>
          </div>
        </TabPanel>

        <TabPanel id="tasks">
          <div className="wrap band tab-band">
            <Panes>
              {tasks.map((task) => (
                <Pane id={`task-${task.id}`} icon="flag" title={task.unit.path} key={task.id}>
                  {task.takingPart ? null : <p className="roll-note">This unit no longer takes part in the event.</p>}
                  <TaskForm
                    id={event.id}
                    task={{
                      id: task.id,
                      unit: task.unit.name,
                      callsign: task.callsign,
                      level: task.level,
                      body: task.body ?? "",
                      reads: task.reads ?? { everyone: "", unit: "", leaders: "", commander: "" },
                    }}
                  />
                  <RemoveTask id={event.id} task={task.id} unit={task.unit.name} />
                </Pane>
              ))}
              <Pane id="task-new" icon="flag" title="Give a unit its task">
                {taskUnits.length > 0 ? (
                  <TaskForm id={event.id} units={taskUnits} />
                ) : (
                  <p>Every unit taking part has its task.</p>
                )}
              </Pane>
              <PlanEditor id={event.id} part="elements" rows={rows.elements} />
              <Pane id="task-key" icon="lock" title="How withholding works" wide>
                <p>
                  A new task starts as the unit&apos;s own. The commanders of the units above always read it, and so do
                  command and whoever runs the event. A unit&apos;s commander can pass a task down inside the unit.
                  Everyone else is shown that the unit has a task, and none of its words. Every task opens to all once
                  the event is closed.
                </p>
                <p>
                  Who commands a unit, and which posts lead, is kept by an admin under Structure. Someone standing in
                  for a post reads what its holder would. A member of the opposing force reads only what everyone reads.
                </p>
              </Pane>
            </Panes>
          </div>
        </TabPanel>
      </Tabs>
    </>
  );
}
