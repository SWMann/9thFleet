import Link from "next/link";
import { Suspense } from "react";
import { site } from "@/lib/site";
import { HullMark } from "./HullMark";
import { NavLinks } from "./NavLinks";

export function Masthead() {
  return (
    <header className="masthead">
      <div className="wrap masthead-row">
        <Link href="/" className="masthead-name">
          <HullMark className="masthead-mark" />
          <span>{site.name}</span>
        </Link>
        <nav aria-label="Main">
          <Suspense fallback={null}>
            <NavLinks />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
