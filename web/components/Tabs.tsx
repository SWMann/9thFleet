"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * A page split into tabs.
 *
 * Every tab is on the page from the start, and only the one that is asked for
 * is shown. The address says which: nothing for the first tab, ?tab=orders for
 * another. Changing tab changes the address without asking the server again,
 * so what has been typed into a form on another tab is still there on the way
 * back, and a link to a tab opens on that tab.
 */

export type TabSpec = {
  id: string;
  label: string;
  icon: IconName;
  /** A short note beside the label, such as a count. */
  badge?: string;
};

const Shown = createContext("");

export function Tabs({ label, tabs, children }: { label: string; tabs: TabSpec[]; children: ReactNode }) {
  const path = usePathname();
  const params = useSearchParams();
  const asked = params.get("tab");
  const shown = tabs.find((tab) => tab.id === asked)?.id ?? tabs[0]?.id ?? "";

  const addressOf = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === tabs[0]?.id) next.delete("tab");
    else next.set("tab", id);
    const query = next.toString();
    return query ? `${path}?${query}` : path;
  };

  // A plain click changes tab in place. A click that asks for a new window is left to the browser.
  const change = (event: MouseEvent<HTMLAnchorElement>, address: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, "", address);
  };

  return (
    <Shown.Provider value={shown}>
      <nav className="subbar subbar-tabs" aria-label={label}>
        <div className="wrap subbar-row subbar-many">
          {tabs.map((tab) => {
            const address = addressOf(tab.id);
            return (
              <a href={address} key={tab.id} aria-current={tab.id === shown ? "page" : undefined} onClick={(event) => change(event, address)}>
                <Icon name={tab.icon} size={18} />
                {tab.label}
                {tab.badge ? <span className="subbar-badge">{tab.badge}</span> : null}
              </a>
            );
          })}
        </div>
      </nav>
      {children}
    </Shown.Provider>
  );
}

/** What one tab holds. It is on the page whichever tab is shown, and hidden unless it is this one. */
export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const shown = useContext(Shown);
  return (
    <div className="tab-panel" id={`tab-${id}`} hidden={shown !== id}>
      {children}
    </div>
  );
}
