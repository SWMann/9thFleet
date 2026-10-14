import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { progressWords } from "@/lib/training-form";
import { getTraining, type Course, type Pass } from "@/lib/training";
import { AwardButton, SignOffForm } from "./TrainingForms";

export const metadata: Metadata = {
  title: "Training",
  robots: { index: false, follow: false },
};

const title = (
  <>
    <strong>Training</strong>
  </>
);

type Asked = Promise<{ member?: string | string[] }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function TrainingPage({ searchParams }: { searchParams: Asked }) {
  return (
    <Suspense fallback={<Head lead="Reading the syllabus." />}>
      <Training asked={searchParams} />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="duty" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (date: string) => dayFormat.format(new Date(date));

async function Training({ asked }: { asked: Asked }) {
  const params = await asked;
  const chosenId = typeof params.member === "string" && UUID.test(params.member) ? params.member : null;
  const result = await getTraining(chosenId);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="Training records are for the serving fleet. You will see the syllabus once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }
  const { courses, mine, held, instructor, awaiting, chosen, serving, names } = result;
  const started = courses.filter((course) => !held.has(course.id) && course.lessons.some((lesson) => mine.has(lesson.id)));
  const heldCount = courses.filter((course) => held.has(course.id)).length;
  const lead =
    courses.length === 0
      ? "No course has been written yet."
      : `${courses.length} ${courses.length === 1 ? "course" : "courses"}. You hold ${heldCount === 0 ? "none yet" : heldCount === 1 ? "one qualification" : `${heldCount} qualifications`}${started.length > 0 ? `, and are in training for ${started.map((course) => course.name).join(", ")}` : ""}.`;

  return (
    <>
      <Head lead={lead}>
        {instructor ? (
          <p className="actions">
            <a className="button button-quiet" href="#sign-off">
              Sign off a lesson
            </a>
          </p>
        ) : null}
      </Head>

      <section className="wrap band" aria-labelledby="syllabus">
        <h2 id="syllabus">
          The <strong>syllabus</strong>
        </h2>
        <p className="intro">
          Each qualification is a course of lessons. An instructor signs off each lesson as you pass it, at a training evolution or one to one,
          and awards the qualification once every lesson is signed off. A course that requires another waits for it.
        </p>
        <ul className="courses">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} passes={mine} held={held.has(course.id)} names={names} own />
          ))}
        </ul>
      </section>

      {instructor ? (
        <section className="wrap band band-last" aria-labelledby="sign-off">
          <h2 id="sign-off">
            Sign off a <strong>lesson</strong>
          </h2>
          <p className="intro">
            Choose a member to see where they are in each course, and tick the lessons they have passed. A pass at a training evolution is signed off
            on the event&apos;s page instead, where it is checked against the roll. You can withdraw your own sign-off until the qualification is
            awarded.
          </p>
          <form method="get" className="fields choose-member" action="/training#sign-off">
            <div className="field">
              <label htmlFor="member">Member</label>
              <select id="member" name="member" defaultValue={chosen?.member.id ?? ""}>
                <option value="">Choose a member</option>
                {serving.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-end">
              <button className="button button-quiet" type="submit">
                Show their training
              </button>
            </div>
          </form>
          {chosen ? (
            <div className="sign-offs">
              <h3>{chosen.member.name}</h3>
              {courses.map((course) => {
                const lessons = course.lessons.map((lesson) => {
                  const pass = chosen.passes.get(lesson.id);
                  return {
                    id: lesson.id,
                    name: lesson.name,
                    description: lesson.description,
                    passedOn: pass?.signedAt ?? null,
                    signedBy: pass?.signedBy ? (names[pass.signedBy] ?? "a former member") : null,
                    mine: pass?.signedBy === result.member.id,
                  };
                });
                const isHeld = chosen.held.has(course.id);
                const needs = course.requires && !chosen.held.has(course.requires.id);
                if (course.lessons.length === 0) return null;
                return (
                  <div className="sign-off-course" key={course.id}>
                    {needs && !isHeld ? (
                      <p className="hint">
                        {course.name} requires {course.requires!.name} first.
                      </p>
                    ) : null}
                    <SignOffForm member={chosen.member.id} course={{ id: course.id, name: course.name }} lessons={lessons} held={isHeld} complete={lessons.every((lesson) => lesson.passedOn !== null)} />
                  </div>
                );
              })}
            </div>
          ) : null}

          <h3 className="with-icon">
            <Icon name="star" size={16} />
            Awaiting the award
          </h3>
          {awaiting.length > 0 ? (
            <ul className="awaiting">
              {awaiting.map((line) => (
                <li key={`${line.memberId}-${line.courseId}`}>
                  <span>
                    <strong>{names[line.memberId] ?? "A member"}</strong> has passed every lesson of {line.course.name}
                    {line.lastSignedAt ? `, the last on ${day(line.lastSignedAt)}` : ""}.
                  </span>
                  {line.memberId !== result.member.id ? <AwardButton member={line.memberId} course={{ id: line.course.id, name: line.course.name }} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nobody is waiting. A member appears here once every lesson of a course is signed off.</p>
          )}
        </section>
      ) : null}
    </>
  );
}

/** One course: its lessons, with the reader's own progress through them. */
function CourseCard({ course, passes, held, names, own }: { course: Course; passes: Map<string, Pass>; held: boolean; names: Record<string, string>; own: boolean }) {
  const passed = course.lessons.filter((lesson) => passes.has(lesson.id)).length;
  const chip = held ? "Held" : passed > 0 ? progressWords(passed, course.lessons.length) : course.lessons.length === 0 ? "No lessons yet" : "Not started";
  return (
    <li className={held ? "course course-held" : "course"}>
      <div className="course-head">
        <h3>{course.name}</h3>
        <span className={held ? "chip chip-on" : "chip"}>{chip}</span>
      </div>
      {course.description ? <p className="course-about">{course.description}</p> : null}
      {course.requires ? (
        <p className="course-requires">
          <Icon name="lock" size={14} /> Requires {course.requires.name} first.
        </p>
      ) : null}
      {course.lessons.length > 0 ? (
        <ol className="lessons">
          {course.lessons.map((lesson) => {
            const pass = passes.get(lesson.id);
            return (
              <li key={lesson.id} className={pass ? "lesson lesson-passed" : "lesson"}>
                <span className="lesson-mark" aria-hidden="true">
                  {pass ? <Icon name="check" size={14} /> : null}
                </span>
                <span className="lesson-words">
                  <strong>{lesson.name}</strong>
                  {lesson.description ? <span className="lesson-about"> {lesson.description}</span> : null}
                  {pass ? (
                    <small className="lesson-when">
                      {own ? "Signed off" : "Passed"} {day(pass.signedAt)}
                      {pass.signedBy ? ` by ${names[pass.signedBy] ?? "a former member"}` : ""}
                      {pass.eventId ? (
                        <>
                          , at <Link href={`/operations/${pass.eventId}`}>a training evolution</Link>
                        </>
                      ) : null}
                    </small>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="course-about">This course has no lessons written yet, so it is awarded on an instructor&apos;s word.</p>
      )}
    </li>
  );
}
