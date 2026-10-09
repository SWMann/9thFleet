"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * A time of day written in UTC, with the reader's own time beside it.
 *
 * The server does not know where the reader is, so the page arrives with the
 * time as it was written. Once it is running in the reader's browser, their
 * own time is added. Someone whose clock is on UTC that day is shown nothing more.
 *
 * `day` is the day the time belongs to, such as the day of the event. Without
 * one it is taken as today, which gives the reader's time as their clock now stands.
 */
export function ZuluTime({ text, hour, minute, day }: { text: string; hour: number; minute: number; day?: string }) {
  const running = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const stamp = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}Z`;
  if (!running) {
    return (
      <time className="zulu" dateTime={stamp}>
        {text}
      </time>
    );
  }
  const on = day ? new Date(day) : new Date();
  const base = Number.isNaN(on.getTime()) ? new Date() : on;
  const at = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute));
  const same = at.getHours() === hour && at.getMinutes() === minute;
  return (
    <time className="zulu" dateTime={at.toISOString()} title={same ? "UTC" : `UTC. ${Intl.DateTimeFormat().resolvedOptions().timeZone} beside it`}>
      {text}
      {same ? null : <span className="zulu-local"> ({clock.format(at)} your time)</span>}
    </time>
  );
}
