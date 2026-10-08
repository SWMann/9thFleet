"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { SIGN_IN_PROBLEMS, countedPath } from "@/lib/visits";

// True once this page load has been counted as a visit. It lives in memory
// only: nothing is stored in the browser, so there is no cookie to consent to.
let landed = false;

/**
 * Tells the site that a public page was read, so it can add one to that page's
 * total for the day. It sends the page's address and nothing else. Browsers
 * that ask not to be tracked send nothing.
 */
export function VisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const asksNotToBeTracked =
      navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
    if (asksNotToBeTracked) return;

    let path = countedPath(pathname);
    if (!path) return;
    if (path === "/sign-in") {
      const problem = new URLSearchParams(window.location.search).get("problem");
      if (problem && SIGN_IN_PROBLEMS.includes(problem)) path = `/sign-in/${problem}`;
    }

    const body = JSON.stringify({ path, landing: !landed });
    landed = true;
    fetch("/visit", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  }, [pathname]);

  return null;
}
