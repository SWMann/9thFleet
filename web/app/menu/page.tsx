import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MenuPanel } from "@/components/MenuPanel";

export const metadata: Metadata = {
  title: "Menu",
  robots: { index: false, follow: false },
};

/** The menu as a page of its own, for a browser that is not running scripts. */
export default function MenuPage() {
  return (
    <div className="menu-page">
      <h1 className="visually-hidden">Menu</h1>
      <MenuPanel />
      <Link className="menu-close" href="/" aria-label="Close the menu">
        <Icon name="close" size={22} />
      </Link>
    </div>
  );
}
