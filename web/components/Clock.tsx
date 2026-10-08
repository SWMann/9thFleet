"use client";

import { useSyncExternalStore } from "react";

const everySecond = (onTick: () => void) => {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
};
const utcNow = () => new Date().toISOString().slice(11, 19);

/**
 * The time in UTC, which is the time the fleet writes its orders in. It is
 * blank until the page is running in the browser, because the server's idea
 * of "now" is when the page was built.
 */
export function Clock() {
  const time = useSyncExternalStore(everySecond, utcNow, () => "");
  return (
    <span className="clock" title="The time in UTC, which the fleet's orders use">
      {time ? `${time} UTC` : ""}
    </span>
  );
}
