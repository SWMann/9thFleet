import Link from "next/link";
import { commonReading } from "@/lib/areas";
import { sectionLink, type SectionLink } from "@/lib/manual";

/**
 * Links to sections of the manual, from addresses written as volume/section.
 * The addresses come from records an admin keeps, so one that points at a
 * section the manual does not have is left out, not allowed to break the page.
 */
function links(addresses: string[]): SectionLink[] {
  const found: SectionLink[] = [];
  for (const address of addresses) {
    const [volume, section] = address.split("/");
    if (!volume || !section) continue;
    try {
      const link = sectionLink(volume, section);
      if (!found.some((entry) => entry.href === link.href)) found.push(link);
    } catch {
      // Not a section of the manual.
    }
  }
  return found;
}

/** What to read: for this role, for its area, then what every member reads. */
export function Reading({ role = [], area }: { role?: string[]; area: string[] }) {
  const forRole = links(role);
  const forArea = links(area).filter((link) => !forRole.some((entry) => entry.href === link.href));
  const everyone = links(commonReading).filter((link) => ![...forRole, ...forArea].some((entry) => entry.href === link.href));
  return (
    <div className="reading">
      {[
        { title: "For this role", links: forRole },
        { title: "For this area", links: forArea },
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

/** Whether any of these addresses is a section of the manual, so a page can leave the list's card out. */
export function hasReading(addresses: string[]): boolean {
  return links(addresses).length > 0;
}

/** One list of sections to read. Nothing is drawn if none of the addresses is a section. */
export function ReadingList({ addresses }: { addresses: string[] }) {
  const found = links(addresses);
  if (found.length === 0) return null;
  return (
    <div className="reading">
      <div>
        <ul>
          {found.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.title}</Link>
              <span>{link.volume}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
