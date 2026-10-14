"use client";

import { useActionState } from "react";
import {
  LESSON_DESCRIPTION_LIMIT,
  LESSON_NAME_LIMIT,
} from "@/lib/training-form";
import {
  awardQualification,
  deleteLesson,
  saveLesson,
  saveRequires,
  signOffLessons,
  withdrawPass,
  type TrainingResult,
} from "./actions";

const untouched: TrainingResult = { ok: false, message: "" };

function Result({ result }: { result: TrainingResult }) {
  return (
    <p
      className={result.ok ? "form-result" : "form-result form-result-bad"}
      role="status"
    >
      {result.message}
    </p>
  );
}

type LessonState = {
  id: string;
  name: string;
  description: string;
  passedOn: string | null;
  signedBy: string | null;
  mine: boolean;
};

/**
 * For an instructor, one member and one course: tick the lessons to sign off.
 * A lesson already passed is shown with who signed it, and the instructor who
 * did can withdraw it until the qualification is awarded. Once every lesson
 * is passed, the qualification is awarded from here, as its own step.
 */
export function SignOffForm({
  member,
  course,
  lessons,
  held,
  complete,
}: {
  member: string;
  course: { id: string; name: string };
  lessons: LessonState[];
  held: boolean;
  complete: boolean;
}) {
  const [signed, signAction, signing] = useActionState(
    signOffLessons,
    untouched,
  );
  const [withdrawn, withdrawAction, withdrawing] = useActionState(
    withdrawPass,
    untouched,
  );
  const [awarded, awardAction, awarding] = useActionState(
    awardQualification,
    untouched,
  );
  const pending = signing || withdrawing || awarding;
  const latest =
    [signed, withdrawn, awarded]
      .filter((result) => result.message)
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0] ?? untouched;
  const open = lessons.filter((lesson) => !lesson.passedOn);
  const withdrawable = held
    ? []
    : lessons
        .filter((lesson) => lesson.passedOn && lesson.mine)
        .map((lesson) => lesson.id);
  return (
    <>
      <WithdrawForms
        member={member}
        lessons={withdrawable}
        action={withdrawAction}
      />
      <form
        action={signAction}
        className="picks sign-off"
        key={`${signed.stamp ?? 0}-${withdrawn.stamp ?? 0}-${awarded.stamp ?? 0}`}
      >
        <input type="hidden" name="member" value={member} />
        <input type="hidden" name="course" value={course.id} />
        <fieldset>
          <legend>{course.name}</legend>
          {held ? <p className="hint">They hold this qualification.</p> : null}
          <ul>
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <label>
                  <input
                    type="checkbox"
                    name="lesson"
                    value={lesson.id}
                    disabled={held || lesson.passedOn !== null}
                    defaultChecked={lesson.passedOn !== null}
                  />
                  <span>
                    {lesson.name}
                    {lesson.passedOn ? (
                      <small>
                        {" "}
                        Signed off {day(lesson.passedOn)}
                        {lesson.signedBy ? ` by ${lesson.signedBy}` : ""}
                      </small>
                    ) : lesson.description ? (
                      <small> {lesson.description}</small>
                    ) : null}
                  </span>
                </label>
                {lesson.passedOn && lesson.mine && !held ? (
                  // Submits the small form for this lesson, below, so the sign-off form's own boxes are not sent with it.
                  <button
                    className="button button-quiet button-small"
                    type="submit"
                    form={`withdraw_${member}_${lesson.id}`}
                    disabled={pending}
                  >
                    Withdraw
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="form-end">
          {!held && open.length > 0 ? (
            <button className="button" type="submit" disabled={pending}>
              {signing ? "Signing off" : "Sign off the ticked lessons"}
            </button>
          ) : null}
          {!held && complete ? (
            <button
              className="button"
              type="submit"
              formAction={awardAction}
              disabled={pending}
            >
              {awarding ? "Awarding" : `Award ${course.name}`}
            </button>
          ) : null}
          <Result result={latest} />
        </div>
      </form>
    </>
  );
}

/** The forms the Withdraw buttons submit: one per lesson the instructor signed off, each naming the member and the lesson. */
export function WithdrawForms({
  member,
  lessons,
  action,
}: {
  member: string;
  lessons: string[];
  action: (formData: FormData) => void;
}) {
  return (
    <>
      {lessons.map((lesson) => (
        <form
          key={lesson}
          id={`withdraw_${member}_${lesson}`}
          action={action}
          hidden
        >
          <input type="hidden" name="member" value={member} />
          <input type="hidden" name="withdraw" value={lesson} />
        </form>
      ))}
    </>
  );
}

/** Award the qualification to a member who has passed every lesson, from the list of those waiting. */
export function AwardButton({
  member,
  course,
}: {
  member: string;
  course: { id: string; name: string };
}) {
  const [result, action, pending] = useActionState(
    awardQualification,
    untouched,
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="member" value={member} />
      <input type="hidden" name="course" value={course.id} />
      <button className="button button-small" type="submit" disabled={pending}>
        {pending ? "Awarding" : `Award ${course.name}`}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (date: string) => dayFormat.format(new Date(date));

/** Command: what a course requires first. */
export function RequiresForm({
  course,
  requires,
  courses,
}: {
  course: { id: string; name: string };
  requires: string | null;
  courses: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState(saveRequires, untouched);
  return (
    <form
      action={action}
      className="fields requires-form"
      key={result.stamp ?? 0}
    >
      <input type="hidden" name="course" value={course.id} />
      <div className="field">
        <label htmlFor={`requires_${course.id}`}>Requires first</label>
        <select
          id={`requires_${course.id}`}
          name="requires"
          defaultValue={requires ?? ""}
        >
          <option value="">Nothing</option>
          {courses
            .filter((other) => other.id !== course.id)
            .map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
        </select>
      </div>
      <div className="form-end">
        <button
          className="button button-quiet"
          type="submit"
          disabled={pending}
        >
          {pending ? "Saving" : "Save"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Command: a lesson's name, description and place, for one that exists or a new one. */
export function LessonForm({
  course,
  lesson,
}: {
  course: string;
  lesson: {
    id: string;
    name: string;
    description: string;
    sortOrder: number;
  } | null;
}) {
  const [result, action, pending] = useActionState(saveLesson, untouched);
  const key = lesson?.id ?? `new_${course}`;
  return (
    <form
      action={action}
      className="fields lesson-form"
      key={result.stamp ?? 0}
    >
      <input type="hidden" name="course" value={course} />
      {lesson ? <input type="hidden" name="lesson" value={lesson.id} /> : null}
      <div className="field">
        <label htmlFor={`name_${key}`}>Name</label>
        <input
          id={`name_${key}`}
          name="name"
          type="text"
          defaultValue={lesson?.name ?? ""}
          maxLength={LESSON_NAME_LIMIT}
          required
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor={`description_${key}`}>
          What it covers <span className="optional">Optional</span>
        </label>
        <textarea
          id={`description_${key}`}
          name="description"
          rows={2}
          defaultValue={lesson?.description ?? ""}
          maxLength={LESSON_DESCRIPTION_LIMIT}
        />
      </div>
      <div className="field field-short">
        <label htmlFor={`order_${key}`}>Place in the list</label>
        <input
          id={`order_${key}`}
          name="sort_order"
          type="number"
          min={0}
          max={9999}
          defaultValue={lesson?.sortOrder ?? 0}
          required
        />
      </div>
      <div className="form-end">
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Saving" : lesson ? "Save" : "Add the lesson"}
        </button>
        <Result result={result} />
      </div>
    </form>
  );
}

/** Command: remove a lesson nobody has passed. */
export function DeleteLessonButton({ lesson }: { lesson: string }) {
  const [result, action, pending] = useActionState(deleteLesson, untouched);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="lesson" value={lesson} />
      <button
        className="button button-quiet button-small"
        type="submit"
        disabled={pending}
      >
        {pending ? "Removing" : "Remove"}
      </button>
      {result.message ? <Result result={result} /> : null}
    </form>
  );
}
