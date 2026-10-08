"use client";

import { useSyncExternalStore } from "react";

const everyMinute = (onTick: () => void) => {
  const timer = setInterval(onTick, 60_000);
  return () => clearInterval(timer);
};

/**
 * Whole days left until a moment, counted in the browser so the figure is
 * right on the day the page is read, not the day it was built. Nothing is
 * shown once the moment has passed.
 */
export function DaysUntil({ at, label }: { at: string; label: string }) {
  const days = useSyncExternalStore(
    everyMinute,
    () => Math.ceil((Date.parse(at) - Date.now()) / 86_400_000),
    () => null,
  );
  if (days !== null && days <= 0) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{days ?? " "}</dd>
    </div>
  );
}
