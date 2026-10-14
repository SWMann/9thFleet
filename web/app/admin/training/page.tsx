import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { gate } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { getSyllabus } from "@/lib/training";
import { DeleteLessonButton, LessonForm, RequiresForm } from "@/app/training/TrainingForms";

export const metadata: Metadata = {
  title: "Training",
  robots: { index: false, follow: false },
};

const title = (
  <>
    The <strong>syllabus</strong>
  </>
);

export default function TrainingAdminPage() {
  return (
    <Suspense fallback={<AdminHead current="training" tier={null} title={title} lead="Reading the syllabus." />}>
      <Syllabus />
    </Suspense>
  );
}

async function Syllabus() {
  const access = await gate("command", "/admin/training");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="training" title={title} />;
  const supabase = await createClient();
  if (!supabase) return <AdminShut access={{ state: "no-database" }} current="training" title={title} />;
  const courses = await getSyllabus(supabase);
  const names = courses.map((course) => ({ id: course.id, name: course.name }));

  return (
    <>
      <AdminHead
        current="training"
        tier={access.tier}
        title={title}
        lead="The lessons of each course, in order, and what each course requires first. Command edits these; an admin adds or removes the qualifications themselves under Structure."
      />
      <section className="wrap band band-last" aria-labelledby="courses">
        <h2 id="courses">
          The <strong>courses</strong>
        </h2>
        <p className="intro">
          A lesson someone has passed stays on the syllabus: rename it or move it instead. Every change is written to the{" "}
          <Link href="/admin/logs?show=structure">logs</Link>. What members see is at <Link href="/training">Training</Link>.
        </p>
        <div className="syllabus-editor">
          {courses.map((course) => (
            <section className="syllabus-course" key={course.id} aria-labelledby={`course-${course.code}`}>
              <h3 id={`course-${course.code}`}>
                {course.name} <span className="chip">{course.lessons.length === 1 ? "1 lesson" : `${course.lessons.length} lessons`}</span>
              </h3>
              {course.description ? <p className="course-about">{course.description}</p> : null}
              <RequiresForm course={{ id: course.id, name: course.name }} requires={course.requires?.id ?? null} courses={names} />
              <ol className="syllabus-lessons">
                {course.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <details>
                      <summary>
                        <strong>{lesson.name}</strong>
                        {lesson.description ? <span className="lesson-about"> {lesson.description}</span> : null}
                      </summary>
                      <LessonForm course={course.id} lesson={lesson} />
                      <DeleteLessonButton lesson={lesson.id} />
                    </details>
                  </li>
                ))}
              </ol>
              <details className="add-lesson">
                <summary>Add a lesson to {course.name}</summary>
                <LessonForm course={course.id} lesson={null} />
              </details>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
