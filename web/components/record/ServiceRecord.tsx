import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Scroll, Stats } from "@/components/admin/Charts";
import { RichLine } from "@/components/rich/Rich";
import {
  activity,
  currentPost,
  dutyTermEnds,
  gradeChanges,
  gradePeriods,
  gradeSince,
  latestFirst,
  lengthBetween,
  returnedNames,
  statusLabel,
  statusSteps,
  today,
  type GradeChange,
} from "@/lib/record";
import type { ServiceRecord } from "@/lib/service-record";
import type { TrainingLine } from "@/lib/training";
import { progressWords } from "@/lib/training-form";

/**
 * A member's service record, as the member reads their own and as staff read
 * anyone's. It is the same record either way. Only the words around it change.
 *
 * Attendance is shown where `attendance` is set. The database decides whether
 * there is any to show: nobody but the member and staff is sent a line of it.
 */

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (date: string) => dayFormat.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date));

const changeWords: Record<GradeChange["kind"], string> = {
  promoted: "Promoted to",
  reduced: "Reduced to",
  confirmed: "Confirmed as",
  "made-acting": "Made acting",
};

export function ServiceRecordView({
  record,
  own,
  attendance,
  notes = false,
  training = [],
}: {
  record: ServiceRecord;
  /** The reader's own record, which changes a few of the words. */
  own: boolean;
  attendance: boolean;
  /** Show the note command left on each appointment. For staff. */
  notes?: boolean;
  /** The courses in progress: started and not yet held. */
  training?: TrainingLine[];
}) {
  const now = record.readAt;
  const on = today(now);
  const rank = (gradeCode: string | null, acting = false) => {
    if (!gradeCode) return "";
    const name = record.rankNames.get(gradeCode);
    return name ? `${acting ? "Acting " : ""}${name}` : gradeCode;
  };

  const posts = latestFirst(record.posts);
  const post = currentPost(record.posts);
  const periods = gradePeriods(record.posts, record.gradeLines);
  const grade = gradeSince(periods);
  const seen = activity(record.events, now);
  const titleOf = new Map(record.posts.map((entry) => [entry.id, entry.title]));

  // Changes of status and of grade as one list, in the order they happened and then turned round, so the latest is
  // first and two on the same day stay in step.
  const steps = [
    ...statusSteps(record.statusLines).map((step) => ({
      on: step.on,
      key: `status-${step.id}`,
      icon: "person" as const,
      what: statusLabel(step),
      detail: step.before && step.beforeSince && step.before !== "applicant" ? `After ${lengthBetween(step.beforeSince, step.on).toLowerCase()} ${beforeWords[step.before]}.` : "",
    })),
    ...gradeChanges(record.posts, record.gradeLines, record.gradeOrder).map((change) => ({
      on: change.on,
      key: `grade-${change.id}`,
      icon: "chevrons" as const,
      // "Made acting" says it already. Any other change names the rank as it is now held, acting or not.
      what: `${changeWords[change.kind]} ${rank(change.gradeCode, change.kind !== "made-acting" && change.acting)}`,
      detail: `${change.gradeCode}, as ${titleOf.get(change.assignmentId) ?? "a post"}.`,
    })),
  ]
    .sort((a, b) => a.on.localeCompare(b.on))
    .reverse();

  return (
    <>
      <section className="wrap band" aria-labelledby="record-figures">
        <h2 id="record-figures">
          Time <strong>served</strong>
        </h2>
        <Stats
          items={[
            post
              ? { label: "In post", value: lengthBetween(post.startedOn, on), note: `${post.title}, since ${day(post.startedOn)}` }
              : { label: "In post", value: "None", note: own ? "You hold no post at the moment" : "Holds no post at the moment" },
            grade
              ? { label: "At this rank", value: lengthBetween(grade.since, on), note: `${rank(grade.gradeCode, grade.acting)}, since ${day(grade.since)}` }
              : { label: "At this rank", value: "None", note: "Counted while a post is held" },
            ...(attendance
              ? [
                  { label: "Events, 30 days", value: seen.in30, note: "Returned present" },
                  { label: "Events, 90 days", value: seen.in90, note: seen.all === 1 ? "1 in all" : `${seen.all} in all` },
                ]
              : []),
          ]}
        />
      </section>

      <section className="wrap band" aria-labelledby="record-posts">
        <h2 id="record-posts">
          Posts <strong>held</strong>
        </h2>
        {posts.length > 0 ? (
          <Scroll label="Posts held">
            <table className="data data-record">
              <thead>
                <tr>
                  <th scope="col">Post</th>
                  <th scope="col">Held as</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">For</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((entry) => (
                  <tr key={entry.id} className={entry.endedOn ? undefined : "data-current"}>
                    <th scope="row">
                      {entry.title}
                      <small>{entry.unit}</small>
                      {notes && entry.note ? <small className="record-note">{entry.note}</small> : null}
                    </th>
                    <td>
                      {entry.kind === "duty" ? "Duty" : rank(entry.gradeCode, entry.acting)}
                      {entry.kind === "primary" && entry.gradeCode ? <small>{entry.gradeCode}</small> : null}
                      {entry.kind === "duty" && !entry.endedOn ? <small>{dutyTermEnds(entry) < on ? `Term ended ${day(dutyTermEnds(entry))}` : `Term to ${day(dutyTermEnds(entry))}`}</small> : null}
                    </td>
                    <td>{day(entry.startedOn)}</td>
                    <td>{entry.endedOn ? day(entry.endedOn) : <span className="chip chip-on">Now</span>}</td>
                    <td>{lengthBetween(entry.startedOn, entry.endedOn ?? on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        ) : (
          <p className="intro">{own ? "You have held no post yet. A full member applies for an open entry post in their branch." : "No post held yet."}</p>
        )}
      </section>

      <section className="wrap band" aria-labelledby="record-standing">
        <h2 id="record-standing">
          Standing and <strong>promotions</strong>
        </h2>
        {steps.length > 0 ? (
          <ol className="record-steps">
            {steps.map((step) => (
              <li key={step.key}>
                <time dateTime={step.on}>{day(step.on)}</time>
                <span className="with-icon">
                  <Icon name={step.icon} size={16} />
                  <strong>{step.what}</strong>
                </span>
                {step.detail ? <small>{step.detail}</small> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="intro">Nothing has been recorded yet.</p>
        )}
      </section>

      {attendance ? (
        <section className="wrap band" aria-labelledby="record-events">
          <h2 id="record-events">
            Events <strong>attended</strong>
          </h2>
          {record.events.length > 0 ? (
            <>
              <p className="intro">
                {seen.all === 1 ? "Present at 1 event" : `Present at ${seen.all} events`}
                {seen.absent > 0 ? `, absent from ${seen.absent}` : ""}.{" "}
                {own ? "Where you were absent is seen by you, by staff and by whoever ran the event." : "This is seen by the member, by staff and by whoever ran each event."}
              </p>
              <Scroll label="Events attended">
                <table className="data data-record">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date</th>
                      <th scope="col">Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.events.map((event) => (
                      <tr key={event.id}>
                        <th scope="row">
                          <Link href={`/operations/${event.id}`}>{event.title}</Link>
                        </th>
                        <td>{event.type}</td>
                        <td>{day(event.startsAt)}</td>
                        <td>
                          <span className={event.returned === "present" ? "chip chip-on" : event.returned === "absent_with_notice" ? "chip" : "chip chip-amber"}>{returnedNames[event.returned]}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroll>
            </>
          ) : (
            <p className="intro">{own ? "No event yet. Whoever runs an event makes its return afterwards, and it is listed here." : "On no event's return yet."}</p>
          )}
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="earned">
        <h2 id="earned">{own ? "What you have earned" : "Earned"}</h2>
        <div className="earned">
          <div>
            <h3 className="with-icon">
              <Icon name="checks" size={16} />
              Qualifications
            </h3>
            {record.qualifications.length > 0 ? (
              <ul>
                {record.qualifications.map((qualification) => (
                  <li key={`${qualification.name}-${qualification.awardedOn}`}>
                    <strong>{qualification.name}</strong>
                    <span>
                      {day(qualification.awardedOn)}
                      {qualification.event ? (
                        <>
                          , at <Link href={`/operations/${qualification.event.id}`}>{qualification.event.title}</Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>None yet. An instructor signs each one off in training.</p>
            )}
            {training.length > 0 ? (
              <>
                <h4 className="with-icon">
                  <Icon name="book" size={14} />
                  In training
                </h4>
                <ul className="in-training">
                  {training.map((line) => (
                    <li key={line.course}>
                      <strong>{line.course}</strong>
                      <span>{progressWords(line.passed, line.lessons)}</span>
                      <ol className="lessons lessons-small">
                        {line.lines.map((lesson) => (
                          <li key={lesson.lesson} className={lesson.passedOn ? "lesson lesson-passed" : "lesson"}>
                            <span className="lesson-mark" aria-hidden="true">
                              {lesson.passedOn ? <Icon name="check" size={12} /> : null}
                            </span>
                            <span className="lesson-words">
                              {lesson.lesson}
                              {lesson.passedOn ? (
                                <small className="lesson-when">
                                  {" "}
                                  {day(lesson.passedOn)}
                                  {lesson.signedBy ? `, ${lesson.signedBy}` : ""}
                                </small>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
                {own ? (
                  <p>
                    The whole syllabus is at <Link href="/training">Training</Link>.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
          <div>
            <h3 className="with-icon">
              <Icon name="star" size={16} />
              Mentions
            </h3>
            {record.mentions.length > 0 ? (
              <ul>
                {record.mentions.map((mention) => (
                  <li key={mention.event.id}>
                    <strong>
                      <RichLine text={mention.citation} />
                    </strong>
                    <span>
                      <Link href={`/operations/${mention.event.id}`}>{mention.event.title}</Link>, {day(mention.mentionedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>None yet. Whoever runs an event can name a member in its after-action report.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

const beforeWords = {
  applicant: "as an applicant",
  recruit: "as a recruit",
  auxiliary: "as an auxiliary",
  member: "as a full member",
  reserve: "in reserve",
  discharged: "out of the fleet",
} as const;
