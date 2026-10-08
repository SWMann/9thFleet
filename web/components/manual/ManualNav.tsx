import Link from "next/link";
import { publishedVolumes, volumes } from "@/lib/manual";

/**
 * The manual's contents: every volume, and the sections of the ones that are
 * published. `current` is the address of the page being read.
 */
export function ManualNav({ current }: { current: string }) {
  const published = new Map(publishedVolumes().map((entry) => [entry.volume.slug, entry]));
  return (
    <nav className="contents" aria-label="Volumes">
      <h2 className="contents-head">Volumes</h2>
      {volumes.map((volume) => {
        const entry = published.get(volume.slug);
        const href = `/manual/${volume.slug}`;
        if (!entry) {
          const label = volume.state === "draft" ? "In review" : "Planned";
          const name = (
            <>
              <span className="contents-number">{volume.number}</span>
              {volume.title}
            </>
          );
          return (
            <div className="contents-volume contents-later" key={volume.slug}>
              {volume.state === "draft" ? (
                <Link className="contents-name" href={href} aria-current={current === href ? "page" : undefined}>
                  <span>{name}</span>
                  <span className="count count-amber">{label}</span>
                </Link>
              ) : (
                <p className="contents-name">
                  <span>{name}</span>
                  <span className="count">{label}</span>
                </p>
              )}
            </div>
          );
        }
        return (
          <details className="contents-volume" key={volume.slug} open={current.startsWith(href)}>
            <summary className="contents-name">
              <span>
                <span className="contents-number">{volume.number}</span>
                {volume.title}
              </span>
              <span className="count">{entry.sections.length}</span>
            </summary>
            <ul>
              <li>
                <Link href={href} aria-current={current === href ? "page" : undefined}>
                  About this volume
                </Link>
              </li>
              {entry.sections.map((section) => {
                const to = `${href}/${section.slug}`;
                return (
                  <li key={section.slug}>
                    <Link href={to} aria-current={current === to ? "page" : undefined}>
                      {section.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </nav>
  );
}
