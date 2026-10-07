"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/standards", label: "Standards" },
  { href: "/joining", label: "Joining" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="nav-links">
      {links.map((link) => (
        <li key={link.href}>
          <Link href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
