import Image from "next/image";
import Link from "next/link";
import { madeByTheCommunity } from "@/lib/pictures";
import { site } from "@/lib/site";
import { Roundel } from "./Crest";

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap foot-row">
        <div className="foot-name">
          <Roundel size={58} muted />
          <span>
            <span className="foot-name-fleet">{site.shortName}</span>
            <span className="foot-name-formation">{site.formation}</span>
          </span>
        </div>
        <div className="foot-note">
          {/* Cloud Imperium's wording for fan sites, word for word. It also asks for a link to the official site. */}
          <p className="foot-notice">
            This is an unofficial Star Citizen fan site, not affiliated with the Cloud Imperium group of companies. All
            content on this site not authored by its host or users are property of their respective owners.
          </p>
          {/* The notice the Fankit Agreement requires wherever fan kit material is used, word for word. */}
          <p className="foot-notice">
            This site is not endorsed by or affiliated with the Cloud Imperium or Roberts Space Industries group of
            companies. All game content and materials are copyright Cloud Imperium Rights LLC and Cloud Imperium Rights
            Ltd.. Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered trademarks
            of Cloud Imperium Rights LLC. All rights reserved.
          </p>
          <p>
            {site.name} is a player-run organisation. The official site is{" "}
            <a href={site.officialSite}>robertsspaceindustries.com</a>.
          </p>
          <ul className="foot-links">
            <li>
              <Link href="/">Front page</Link>
            </li>
            <li>
              <Link href="/standards">Standards</Link>
            </li>
            <li>
              <Link href="/joining">Joining</Link>
            </li>
            <li>
              <Link href="/manual">Fleet manual</Link>
            </li>
            <li>
              <Link href="/roles">Roles</Link>
            </li>
            <li>
              <Link href="/credits">Picture credits</Link>
            </li>
          </ul>
          <p>
            {site.formation}, Stanton. Flagship {site.flagship}.
          </p>
        </div>
        <Image className="foot-made" src={madeByTheCommunity} alt="Star Citizen: made by the community" sizes="104px" />
      </div>
    </footer>
  );
}
