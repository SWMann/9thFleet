import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Icon, type IconName } from "@/components/Icon";
import { ServiceRecordView } from "@/components/record/ServiceRecord";
import { gate, reaches, serviceNames, statusNames } from "@/lib/admin";
import { formatDate } from "@/lib/application-form";
import { dutyTermEnds, lengthBetween, today } from "@/lib/record";
import { RenewDutyForm } from "./DutyTools";
import type { Role } from "@/lib/member";
import { getRecordSubject, getServiceRecord } from "@/lib/service-record";
import { getTrainingRecord } from "@/lib/training";

export const metadata: Metadata = {
  title: "A member's record",
  robots: { index: false, follow: false },
};

const title = (
  <>
    A member&apos;s <strong>record</strong>
  </>
);

export default function MemberRecordPage({ params }: PageProps<"/admin/people/[id]">) {
  return (
    <Suspense fallback={<AdminHead current="people" tier={null} title={title} lead="Reading the record." />}>
      <MemberRecord params={params} />
    </Suspense>
  );
}

const roleNames: Record<Role, string> = { instructor: "Instructor", staff: "Staff", command: "Command", admin: "Admin" };

async function MemberRecord({ params }: { params: PageProps<"/admin/people/[id]">["params"] }) {
  const { id } = await params;
  const access = await gate("staff", "/admin/people/[id]");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="people" title={title} />;

  const subject = await getRecordSubject(id);
  if (!subject) notFound();
  const [record, training] = await Promise.all([getServiceRecord(subject.id, subject.service), getTrainingRecord(subject.id)]);
  const rank = subject.rankName ? `${subject.acting ? "Acting " : ""}${subject.rankName} ` : "";
  // The duties held now, each with its term, for command to renew.
  const on = today(record.readAt);
  const duties = reaches(access.tier, "command") ? record.posts.filter((post) => post.kind === "duty" && !post.endedOn).map((post) => ({ ...post, ends: dutyTermEnds(post) })) : [];

  return (
    <>
      <AdminHead
        current="people"
        tier={access.tier}
        title={<strong>{`${rank}${subject.name}`}</strong>}
        lead={subject.postTitle ? `${subject.postTitle}, ${subject.unitName}.` : `${statusNames[subject.status]}. Holds no post.`}
        before={
          <p className="back">
            <Link href="/admin/people">Everyone on the books</Link>
          </p>
        }
      />

      <section className="wrap band" aria-labelledby="standing">
        <h2 id="standing">
          Where they <strong>stand</strong>
        </h2>
        <dl className="facts">
          <Line icon="person" label="Status" value={statusNames[subject.status]} />
          <Line icon="anchor" label="Service" value={subject.service ? serviceNames[subject.service] : "Not set"} />
          <Line icon="chevrons" label="Rank" value={rank.trim() || "None"} note={subject.gradeCode ?? undefined} />
          <Line icon="flag" label="Post" value={subject.postTitle ?? "None"} note={subject.unitName ?? undefined} />
          {subject.roles.length > 0 ? (
            <Line icon="shield" label="Roles on this site" value={subject.roles.map((role) => roleNames[role as Role] ?? role).join(", ")} />
          ) : null}
          <Line icon="globe" label="RSI handle" value={subject.rsiHandle ?? "Not set"} />
          <Line icon="headset" label="Discord" value={subject.discordName ?? "Unknown"} />
          <Line icon="calendar" label="First signed in" value={subject.joinedOn ? formatDate(subject.joinedOn) : "Unknown"} />
        </dl>
      </section>

      {duties.length > 0 ? (
        <section className="wrap band" aria-labelledby="duties">
          <h2 id="duties">
            Secondary <strong>duties</strong>
          </h2>
          <p className="intro">A duty runs for three months at a time. Renewing it starts another term from today; ending it is done where the appointment was made.</p>
          <ul className="duties">
            {duties.map((duty) => (
              <li key={duty.id} className={duty.ends < on ? "duty duty-over" : "duty"}>
                <div>
                  <strong>{duty.title}</strong>
                  <span className="aside">{duty.unit}</span>
                  <small>
                    {duty.ends < on
                      ? `Term ended ${formatDate(duty.ends)}, ${lengthBetween(duty.ends, on).toLowerCase()} ago.`
                      : `Term to ${formatDate(duty.ends)}, ${lengthBetween(on, duty.ends).toLowerCase()} left.`}
                    {duty.renewedOn ? ` Last renewed ${formatDate(duty.renewedOn)}.` : ""}
                  </small>
                </div>
                <RenewDutyForm assignment={duty.id} title={duty.title} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ServiceRecordView record={record} own={false} attendance notes training={training} />
    </>
  );
}

function Line({ icon, label, value, note }: { icon: IconName; label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="with-icon">
        <Icon name={icon} size={14} />
        {label}
      </dt>
      <dd>
        {value}
        {note ? <span className="aside">{note}</span> : null}
      </dd>
    </div>
  );
}
