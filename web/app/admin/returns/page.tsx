import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminHead, AdminShut } from "@/components/admin/AdminHead";
import { Scroll } from "@/components/admin/Charts";
import { gate } from "@/lib/admin";
import { getMonthlyReturns, monthName } from "@/lib/returns";

export const metadata: Metadata = {
  title: "Monthly returns",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Monthly <strong>returns</strong>
  </>
);

export default function ReturnsPage() {
  return (
    <Suspense fallback={<AdminHead current="returns" tier={null} title={title} lead="Reading the returns." />}>
      <Returns />
    </Suspense>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Returns() {
  const access = await gate("command", "/admin/returns");
  if (access.state === "signed-out") redirect("/sign-in");
  if (access.state === "no-record") redirect("/profile");
  if (access.state !== "ready") return <AdminShut access={access} current="returns" title={title} />;
  const returns = await getMonthlyReturns();
  const latest = returns[0];

  return (
    <>
      <AdminHead
        current="returns"
        tier={access.tier}
        title={title}
        lead={
          latest
            ? `The strength and readiness returns Volume 2 asks for, written by the database on the first of each month. The latest is for ${monthName(latest.month)}.`
            : "The strength and readiness returns Volume 2 asks for. The database writes the first on the first of next month, for the month just ended."
        }
      />
      <section className="wrap band band-last" aria-labelledby="returns">
        <h2 id="returns">
          Month by <strong>month</strong>
        </h2>
        <p className="intro">
          Strength is the serving fleet at the end of the month. Joined and left count who came into the serving fleet and who went out of it. The register
          is counted as the month ends; months before it was kept show none. Attendances are members returned present at the events held that month.
        </p>
        {returns.length === 0 ? (
          <p className="intro">No return has been recorded yet.</p>
        ) : (
          <Scroll label="Monthly returns">
            <table className="data data-returns">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Serving</th>
                  <th scope="col">Full members</th>
                  <th scope="col">Auxiliaries</th>
                  <th scope="col">Recruits</th>
                  <th scope="col">Reserve</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Left</th>
                  <th scope="col">Hulls ready</th>
                  <th scope="col">Events held</th>
                  <th scope="col">Attendances</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((line) => (
                  <tr key={line.month}>
                    <th scope="row">{monthName(line.month)}</th>
                    <td>{line.serving}</td>
                    <td>{line.members}</td>
                    <td>{line.auxiliaries}</td>
                    <td>{line.recruits}</td>
                    <td>{line.reserve}</td>
                    <td>{line.joined}</td>
                    <td>{line.departed}</td>
                    <td>{line.hulls === null ? "Not kept" : `${line.hullsReady ?? 0} of ${line.hulls}`}</td>
                    <td>{line.eventsHeld}</td>
                    <td>{line.attendances}</td>
                    <td>{dayFormat.format(new Date(line.recordedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </section>
    </>
  );
}
