"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const links = [
  { href: "/standards", label: "Standards" },
  { href: "/joining", label: "Joining" },
] as const;

/**
 * Whether the server has left its "signed in" hint in this browser. The hint
 * only chooses which link to show. The session itself is in cookies that
 * scripts cannot read, and the member pages check it on the server.
 */
function hasSignedInHint() {
  return /(?:^|;\s*)nf_signed_in=1(?:;|$)/.test(document.cookie);
}
const subscribe = () => () => {};

export function NavLinks() {
  const pathname = usePathname();
  const signedIn = useSyncExternalStore(subscribe, hasSignedInHint, () => false);
  const forYou = signedIn
    ? [
        // The page is the order of battle. "Fleet" is short enough for a phone's menu.
        { href: "/order-of-battle", label: "Fleet" },
        { href: "/profile", label: "Your record" },
      ]
    : [{ href: "/sign-in", label: "Sign in" }];

  return (
    <ul className="nav-links">
      {[...links, ...forYou].map((link) => (
        <li key={link.href}>
          <Link href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
