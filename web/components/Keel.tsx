import Link from "next/link";
import { site } from "@/lib/site";

/** The footer: everything below the waterline. */
export function Keel() {
  return (
    <footer className="keel">
      <div className="wrap keel-row">
        <div>
          <p className="keel-name">{site.name}</p>
          <p>
            {site.formation}, Stanton. Flagship {site.flagship}.
          </p>
        </div>
        <ul className="keel-links">
          <li>
            <Link href="/">Front page</Link>
          </li>
          <li>
            <Link href="/standards">Standards</Link>
          </li>
          <li>
            <Link href="/joining">Joining</Link>
          </li>
        </ul>
        <p className="keel-note">
          {site.name} is a player-run organisation in Star Citizen. It is not affiliated with Cloud Imperium Games or
          Roberts Space Industries. Star Citizen is a trademark of Cloud Imperium.
        </p>
      </div>
    </footer>
  );
}
