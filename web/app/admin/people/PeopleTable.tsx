"use client";

import { useMemo, useState } from "react";

export type PersonRow = {
  id: string;
  /** Rank and name, as the fleet writes them. */
  name: string;
  handle: string;
  discord: string;
  status: string;
  statusName: string;
  service: string;
  serviceName: string;
  grade: string;
  post: string;
  unit: string;
  duty: string;
  joined: string;
  joinedOn: string;
  daysIn: number;
  roles: string;
  qualifications: string[];
  /** Null when this reader is not shown attendance. */
  attendance: { in30: number; in90: number; all: number; absent90: number; last: string; lastAt: string } | null;
};

const SERVING = ["recruit", "auxiliary", "member", "reserve"];

const sorts = {
  name: { label: "Name", sort: (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name) },
  longest: { label: "Longest on the books", sort: (a: PersonRow, b: PersonRow) => a.joinedOn.localeCompare(b.joinedOn) },
  newest: { label: "Newest on the books", sort: (a: PersonRow, b: PersonRow) => b.joinedOn.localeCompare(a.joinedOn) },
  most: {
    label: "Most events in 90 days",
    sort: (a: PersonRow, b: PersonRow) => (b.attendance?.in90 ?? 0) - (a.attendance?.in90 ?? 0),
  },
  fewest: {
    label: "Fewest events in 90 days",
    sort: (a: PersonRow, b: PersonRow) => (a.attendance?.in90 ?? 0) - (b.attendance?.in90 ?? 0),
  },
};
type SortKey = keyof typeof sorts;

/**
 * Everyone on the books, with a row of filters above. Without scripts the
 * whole table is shown.
 */
export function PeopleTable({
  people,
  statuses,
  services,
}: {
  people: PersonRow[];
  statuses: { key: string; name: string }[];
  services: { key: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");
  const withAttendance = people.some((person) => person.attendance);

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    return people
      .filter((person) => (status === "all" ? true : status === "serving" ? SERVING.includes(person.status) : person.status === status))
      .filter((person) => service === "all" || person.service === service)
      .filter((person) => !words || `${person.name} ${person.handle} ${person.discord} ${person.post}`.toLowerCase().includes(words))
      .sort(sorts[sort].sort);
  }, [people, search, status, service, sort]);

  return (
    <>
      <div className="filters">
        <label>
          <span>Find</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, handle or post" />
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="serving">Serving</option>
            {statuses.map((entry) => (
              <option value={entry.key} key={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Service</span>
          <select value={service} onChange={(event) => setService(event.target.value)}>
            <option value="all">Every service</option>
            {services.map((entry) => (
              <option value={entry.key} key={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Order</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            {(Object.keys(sorts) as SortKey[])
              .filter((key) => withAttendance || (key !== "most" && key !== "fewest"))
              .map((key) => (
                <option value={key} key={key}>
                  {sorts[key].label}
                </option>
              ))}
          </select>
        </label>
        <p className="filters-count" aria-live="polite">
          {shown.length === people.length ? `${people.length} people` : `${shown.length} of ${people.length} people`}
        </p>
      </div>

      <div className="table-scroll" tabIndex={0} role="group" aria-label="Everyone on the books">
        <table className="data data-people">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Post</th>
              <th scope="col">First signed in</th>
              <th scope="col">Qualifications</th>
              {withAttendance ? (
                <>
                  <th scope="col" className="number">
                    Events, 30 days
                  </th>
                  <th scope="col" className="number">
                    90 days
                  </th>
                  <th scope="col" className="number">
                    All
                  </th>
                  <th scope="col" className="number">
                    Absent without notice, 90 days
                  </th>
                  <th scope="col">Last attended</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((person) => (
              <tr key={person.id}>
                <th scope="row">
                  {person.name}
                  <small>
                    {person.handle} · {person.discord}
                  </small>
                </th>
                <td>
                  {person.statusName}
                  <small>
                    {[person.serviceName, person.grade, person.roles].filter(Boolean).join(" · ")}
                  </small>
                </td>
                <td>
                  {person.post || "None"}
                  <small>{[person.unit, person.duty].filter(Boolean).join(" · ")}</small>
                </td>
                <td>
                  {person.joined}
                  <small>{person.daysIn === 1 ? "1 day" : `${person.daysIn} days`}</small>
                </td>
                <td>{person.qualifications.length > 0 ? person.qualifications.join(", ") : "None"}</td>
                {person.attendance ? (
                  <>
                    <td className="number">{person.attendance.in30}</td>
                    <td className="number">{person.attendance.in90}</td>
                    <td className="number">{person.attendance.all}</td>
                    <td className="number">{person.attendance.absent90}</td>
                    <td>{person.attendance.last}</td>
                  </>
                ) : withAttendance ? (
                  <td colSpan={5} />
                ) : null}
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={withAttendance ? 10 : 5}>Nobody matches.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
