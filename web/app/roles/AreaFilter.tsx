"use client";

import { useState, type ReactNode } from "react";

type Group = { key: string; label: string; areas: number; open: number };

/**
 * The buttons above the areas, and the areas themselves. Choosing a button
 * hides the tiles of every other group. Without scripts every area is shown.
 */
export function AreaFilter({ groups, children }: { groups: Group[]; children: ReactNode }) {
  const [shown, setShown] = useState("all");
  const all: Group = {
    key: "all",
    label: "All areas",
    areas: groups.reduce((sum, group) => sum + group.areas, 0),
    open: groups.reduce((sum, group) => sum + group.open, 0),
  };
  const current = [all, ...groups].find((group) => group.key === shown) ?? all;

  return (
    <>
      <div className="filter">
        <div className="tabs" role="group" aria-label="Show">
          {[all, ...groups].map((group) => (
            <button
              className="tab"
              type="button"
              key={group.key}
              aria-pressed={group.key === shown}
              onClick={() => setShown(group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
        <p className="filter-count" aria-live="polite">
          {current.areas} {current.areas === 1 ? "area" : "areas"} ·{" "}
          {current.open > 0 ? `${current.open} open now` : "none open yet"}
        </p>
      </div>
      <div className="tiles" data-show={shown}>
        {children}
      </div>
    </>
  );
}
