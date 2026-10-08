"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The Menu link and the full-screen menu it opens. Without scripts the link
 * goes to /menu, which shows the same columns as a page.
 */
export function Menu({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  // Arriving at a new page closes the menu that led there.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  const open = (event: MouseEvent) => {
    if (!dialog.current?.showModal) return;
    event.preventDefault();
    dialog.current.showModal();
  };
  // A link to the page you are already on does not change the address, so close on the click as well.
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("a")) dialog.current?.close();
  };

  return (
    <>
      <Link className="head-link head-menu" href="/menu" prefetch={false} aria-haspopup="dialog" onClick={open}>
        <Icon name="menu" size={20} />
        Menu
      </Link>
      <dialog ref={dialog} className="menu" aria-label="All pages" onClick={closeOnLink}>
        {children}
        <form method="dialog">
          <button className="menu-close" type="submit" aria-label="Close the menu">
            <Icon name="close" size={22} />
          </button>
        </form>
      </dialog>
    </>
  );
}
