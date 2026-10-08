"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * A moment in the reader's own time, beside the UTC the fleet's orders use.
 *
 * The server does not know where the reader is, so the page arrives with what
 * the server was given to show (the time in the UK). Once the page is running
 * in the reader's browser, that is replaced with their own clock's time.
 */
export function YourTime({ iso, fallback, withDay = false }: { iso: string; fallback: string; withDay?: boolean }) {
  const running = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!running) return <span className="aside">{fallback}</span>;
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  // Said when the reader's day is not the UTC day, which is when it matters.
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(at);
  const utcDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(at);
  return (
    <span className="aside" title={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      {time} your time{withDay && day !== utcDay ? `, ${day}` : ""}
    </span>
  );
}
