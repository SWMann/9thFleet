import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * A card with a small title: one piece of a page that is laid out as cards.
 * Several sit side by side in a <Panes>, and a wide one takes the whole row.
 */
export function Pane({
  id,
  icon,
  title,
  wide = false,
  children,
}: {
  /** Names the card's title, so the card can be found by it. */
  id: string;
  icon: IconName;
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={wide ? "pane pane-wide" : "pane"} aria-labelledby={id}>
      <h2 className="pane-title" id={id}>
        <Icon name={icon} size={18} />
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

export function Panes({ children }: { children: ReactNode }) {
  return <div className="panes">{children}</div>;
}
