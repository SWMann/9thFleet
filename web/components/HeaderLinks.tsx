"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useSignedIn } from "./useSignedIn";

export function HeaderLinks() {
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const links = signedIn
    ? [
        // The page is the order of battle. "Fleet" is short enough for a phone.
        { href: "/order-of-battle", label: "Fleet", icon: null },
        { href: "/profile", label: "Your record", icon: null },
      ]
    : [
        { href: "/sign-in", label: "Sign in", icon: "signIn" as const },
        { href: "/joining", label: "Join", icon: null },
      ];

  return (
    <ul className="head-links">
      {links.map((link) => (
        <li key={link.href}>
          <Link className="head-link" href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
            {link.icon ? <Icon name={link.icon} size={17} /> : null}
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
