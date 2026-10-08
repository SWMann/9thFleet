import Link from "next/link";
import { commonReading } from "@/lib/areas";
import { sectionLink } from "@/lib/manual";

/** The sections of the manual to read for an area, then the ones every member reads. */
export function Reading({ area }: { area: [string, string][] }) {
  const mine = area.map(([volume, section]) => sectionLink(volume, section));
  const everyone = commonReading.map(([volume, section]) => sectionLink(volume, section));
  return (
    <div className="reading">
      {[
        { title: "For this area", links: mine },
        { title: "For every member", links: everyone },
      ]
        .filter((group) => group.links.length > 0)
        .map((group) => (
          <div key={group.title}>
            <h3>{group.title}</h3>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.title}</Link>
                  <span>{link.volume}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
