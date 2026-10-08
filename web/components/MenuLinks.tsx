"use client";

import Link from "next/link";
import type { MenuGroup } from "@/lib/menu";
import { useSignedIn } from "./useSignedIn";

/** One menu column's links. A column with member pages changes once you have signed in. */
export function MenuLinks({ group }: { group: MenuGroup }) {
  const signedIn = useSignedIn();
  const forMember = signedIn && group.signedIn;
  const links = forMember ? group.signedIn! : group.links;
  return (
    <>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
      {group.note && !forMember ? <p className="menu-note">{group.note}</p> : null}
    </>
  );
}
