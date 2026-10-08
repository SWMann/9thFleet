import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Bars, Columns, Panel, Scroll, Stats } from "@/components/admin/Charts";
import {
  acting,
  byBand,
  byService,
  gate,
  joiners,
  loadFleet,
  qualificationHolders,
  reaches,
  serviceNames,
  statusNames,
  strength,
  type Person,
} from "@/lib/admin";
import { formatDate } from "@/lib/application-form";
import type { Role, Service, Status } from "@/lib/member";
import { PeopleTable, type PersonRow } from "./PeopleTable";

export const metadata: Metadata = {
  title: "People",
  robots: { index: false, follow: false },
};

const title = <strong>People</strong>;

export default function PeoplePage() {
  return (
    <Suspense fallback={<AdminHead current="people" tier={null} title={title} lead="Reading the fleet's people." />}>
      <People />
    </Suspense>
  );
}

const roleNames: Record<Role, string> = { instructor: "Instructor", staff: "Staff", command: "Command", admin: "Admin" };

async function People() {
  const access = await gate("staff", "/admin/people");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="people" title={title} />;
  const loaded = await loadFleet();
  if (loaded.state !== "ready") return <AdminShut access={loaded} current="people" title={title} />;

  const { fleet } = loaded;
  const { tier } = access;
  const force = strength(fleet);
  const count = (status: Status) => fleet.people.filter((person) => person.status === status).length;
  const temporary = acting(fleet);
  // Attendance is for command. Staff see who is on the books and what they hold.
  const withAttendance = reaches(tier, "command");

  const rows = fleet.people.map((person): PersonRow => row(person, withAttendance));

  return (
    <>
      <AdminHead
        current="people"
        tier={tier}
        title={title}
        lead={`${force.serving} serving: ${force.active} active and ${count("reserve")} in reserve. ${count("applicant")} ${count("applicant") === 1 ? "applicant has" : "applicants have"} signed in and not joined.`}
      />

      <section className="wrap band" aria-labelledby="standing">
        <h2 id="standing">
          Who is <strong>serving</strong>
        </h2>
        <Stats
          items={[
            { label: "Recruits", value: count("recruit"), note: "In training" },
            { label: "Auxiliaries", value: count("auxiliary"), note: "Trained, before their first operation" },
            { label: "Full members", value: count("member") },
            { label: "Reserve", value: count("reserve"), note: "Away, record kept" },
            { label: "Acting appointments", value: temporary.length, note: "Each lasts up to 60 days" },
            { label: "Discharged", value: count("discharged"), note: "Have left the fleet" },
          ]}
        />
        <div className="charts">
          <Panel title="By service" note="Serving members, by the service they belong to.">
            <Bars caption="Serving members by service" head={["Service", "Members"]} rows={byService(fleet)} empty="Nobody is serving yet." />
          </Panel>
          <Panel title="By grade" note="Serving members, by where their grade sits on the ladder.">
            <Bars caption="Serving members by grade" head={["Grades", "Members"]} rows={byBand(fleet)} empty="Nobody is serving yet." />
          </Panel>
          <Panel title="Qualifications held" note="How many serving members hold each one.">
            <Bars
              caption="Serving members holding each qualification"
              head={["Qualification", "Members"]}
              rows={qualificationHolders(fleet)}
              empty="No qualification has been awarded yet."
            />
          </Panel>
          <Panel title="Joined, month by month" note="Applications accepted in each of the last six months.">
            <Columns caption="Applications accepted in each of the last six months"
              series={joiners(fleet)}
              noun={["person", "people"]}
              empty="Nobody has been accepted in the last six months." />
          </Panel>
        </div>
      </section>

      {temporary.length > 0 ? (
        <section className="wrap band" aria-labelledby="acting">
          <h2 id="acting">
            Acting <strong>appointments</strong>
          </h2>
          <p className="intro">An acting appointment lasts up to 60 days, then is confirmed, extended once or ended.</p>
          <Scroll label="Acting appointments">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Acting as</th>
                  <th scope="col" className="number">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {temporary.map((entry) => (
                  <tr key={entry.id}>
                    <th scope="row">{entry.name}</th>
                    <td>{entry.post}</td>
                    <td className="number">
                      {entry.days}
                      {entry.days > 60 ? <span className="chip chip-amber">Over 60</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="everyone">
        <h2 id="everyone">
          Everyone on the <strong>books</strong>
        </h2>
        <p className="intro">
          {withAttendance
            ? "Each person, what they hold, and the events they were returned present at."
            : "Each person and what they hold. Attendance is on the pages command sees."}
        </p>
        <PeopleTable
          people={rows}
          statuses={(Object.keys(statusNames) as Status[]).map((key) => ({ key, name: statusNames[key] }))}
          services={(Object.keys(serviceNames) as Service[]).map((key) => ({ key, name: serviceNames[key] }))}
        />
      </section>
    </>
  );
}

function row(person: Person, withAttendance: boolean): PersonRow {
  const rank = person.rankName ? `${person.acting ? "Acting " : ""}${person.rankName} ` : "";
  return {
    id: person.id,
    name: `${rank}${person.name}`,
    handle: person.rsiHandle ?? "No RSI handle",
    discord: person.discordName ?? "Discord unknown",
    status: person.status,
    statusName: statusNames[person.status],
    service: person.service ?? "",
    serviceName: person.service ? serviceNames[person.service] : "",
    grade: person.gradeCode ?? "",
    post: person.postTitle ?? "",
    unit: person.unitName ?? "",
    duty: person.dutyTitle ? `Duty: ${person.dutyTitle}` : "",
    joined: person.joinedOn ? formatDate(person.joinedOn) : "Unknown",
    joinedOn: person.joinedOn,
    daysIn: person.daysIn,
    roles: person.roles.map((role) => roleNames[role]).join(", "),
    qualifications: person.qualifications,
    attendance: withAttendance
      ? {
          in30: person.attended30,
          in90: person.attended90,
          all: person.attendedAll,
          absent90: person.absentWithoutNotice90,
          last: person.lastAttended ? formatDate(person.lastAttended) : "Never",
          lastAt: person.lastAttended ?? "",
        }
      : null,
  };
}
