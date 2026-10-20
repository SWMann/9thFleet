import Link from "next/link";
import { Scroll } from "@/components/admin/Charts";
import { stationName, type CrewTemplate, type Fit, type Station } from "@/lib/ships";

/**
 * One crew template as a captain would brief it: by department, each
 * station with its seats, how many of them are needed to sail, what it does
 * aboard this model, who stands in for it, and whether the reader could
 * fill it.
 */
export function CrewTemplateView({ template, fit }: { template: CrewTemplate; fit: Record<string, Fit> }) {
  const byId = new Map(template.stations.map((station) => [station.id, station]));
  const grouped = template.groups.map((group) => ({ key: group.id, name: group.name, stations: template.stations.filter((station) => station.groupId === group.id) })).filter((group) => group.stations.length > 0);
  const loose = template.stations.filter((station) => station.groupId === null || !template.groups.some((group) => group.id === station.groupId));
  const parts = loose.length > 0 ? [...grouped, { key: "loose", name: grouped.length > 0 ? "Other stations" : "Stations", stations: loose }] : grouped;
  const roles = new Set(template.stations.map((station) => station.roleId));
  const could = [...roles].filter((roleId) => fit[roleId]?.state === "holds" || fit[roleId]?.state === "qualified").length;

  return (
    <section className="crew-template" aria-labelledby={`template-${template.id}`}>
      <h3 id={`template-${template.id}`}>
        {template.name}
        {template.isDefault && template.name !== "Standard" ? <span className="chip">Standard</span> : null}
      </h3>
      <p className="crew-facts">
        <span>
          <strong>{template.seats}</strong> {template.seats === 1 ? "seat" : "seats"}
        </span>
        {template.minimumSeats > 0 ? (
          <span>
            <strong>{template.minimumSeats}</strong> to sail
          </span>
        ) : (
          <span className="muted">Watch bill not set</span>
        )}
        {roles.size > 0 ? (
          <span>
            You could fill <strong>{could}</strong> of {roles.size} {roles.size === 1 ? "role" : "roles"} aboard
          </span>
        ) : null}
        {template.source ? <span className="crew-source">{template.source}</span> : null}
      </p>
      {template.stations.length === 0 ? (
        <p className="intro">No stations have been set for it yet.</p>
      ) : (
        parts.map((part) => (
          <div className="crew-group" key={part.key}>
            <h4>
              {part.name}
              <span className="crew-group-seats">
                {part.stations.reduce((sum, station) => sum + station.count, 0)} {part.stations.reduce((sum, station) => sum + station.count, 0) === 1 ? "seat" : "seats"}
                {part.stations.some((station) => station.minimum > 0) ? `, ${part.stations.reduce((sum, station) => sum + station.minimum, 0)} to sail` : ""}
              </span>
            </h4>
            <Scroll label={`${part.name} stations`}>
              <table className="data data-crew">
                <thead>
                  <tr>
                    <th scope="col">Station</th>
                    <th scope="col" className="number">
                      Seats
                    </th>
                    <th scope="col">What it does</th>
                    <th scope="col">Stand-in</th>
                    <th scope="col">You</th>
                  </tr>
                </thead>
                <tbody>
                  {part.stations.map((station) => (
                    <StationRow key={station.id} station={station} standIn={station.standInId ? (byId.get(station.standInId) ?? null) : null} fit={fit[station.roleId]} />
                  ))}
                </tbody>
              </table>
            </Scroll>
          </div>
        ))
      )}
    </section>
  );
}

function StationRow({ station, standIn, fit }: { station: Station; standIn: Station | null; fit: Fit | undefined }) {
  return (
    <tr className={station.minimum > 0 ? "crew-essential" : undefined}>
      <th scope="row">
        {station.name ? (
          <>
            {station.name}
            <small>{station.roleHref ? <Link href={station.roleHref}>{station.role}</Link> : station.role}</small>
          </>
        ) : station.roleHref ? (
          <Link href={station.roleHref}>{station.role}</Link>
        ) : (
          station.role
        )}
      </th>
      <td className="number">
        {station.count}
        {station.minimum > 0 ? <small>{station.minimum === station.count ? (station.count === 1 ? "needed to sail" : "all needed to sail") : `${station.minimum} needed to sail`}</small> : null}
      </td>
      <td className="crew-brief">{station.brief || <span className="muted">Not written yet</span>}</td>
      <td>{standIn ? stationName(standIn) : <span className="muted">None</span>}</td>
      <td>
        <FitChip fit={fit} />
      </td>
    </tr>
  );
}

function FitChip({ fit }: { fit: Fit | undefined }) {
  if (!fit) return null;
  if (fit.state === "holds") return <span className="chip chip-on">Yours</span>;
  if (fit.state === "qualified") return <span className="chip chip-on">Qualified</span>;
  if (fit.state === "appointed") return <span className="chip">By appointment</span>;
  return (
    <span className="fit-needs">
      <span className="chip chip-amber">Needs</span> {fit.qualifications.join(", ")}
    </span>
  );
}
