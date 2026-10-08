import Link from "next/link";
import { Suspense } from "react";
import { site } from "@/lib/site";
import { Clock } from "./Clock";
import { Roundel } from "./Crest";
import { HeaderLinks } from "./HeaderLinks";
import { Menu } from "./Menu";
import { MenuPanel } from "./MenuPanel";

export function SiteHeader() {
  return (
    <header className="head">
      <div className="wrap head-row">
        <Link href="/" className="head-name">
          <Roundel size={36} />
          <span>{site.shortName}</span>
        </Link>
        <nav aria-label="Main" className="head-nav">
          <Suspense fallback={null}>
            <HeaderLinks />
          </Suspense>
          <Clock />
          <Suspense fallback={null}>
            <Menu>
              <MenuPanel />
            </Menu>
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
