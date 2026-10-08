import Link from "next/link";
import { sheets } from "@/lib/structure";

/** The editors, as a row of links under the page's head. */
export function StructureNav({ current }: { current: string }) {
  const links = [
    { key: "index", href: "/admin/structure", label: "All" },
    ...sheets.map((sheet) => ({ key: sheet.key as string, href: `/admin/structure/${sheet.key}`, label: sheet.many })),
    { key: "ranks", href: "/admin/structure/ranks", label: "Ranks and grades" },
  ];
  return (
    <nav aria-label="The editors">
      <ul className="parts editor-nav">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href} aria-current={link.key === current ? "page" : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
