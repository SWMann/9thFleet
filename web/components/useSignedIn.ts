"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the server has left its "signed in" hint in this browser. The hint
 * only chooses which links to show. The session itself is in cookies that
 * scripts cannot read, and the member pages check it on the server.
 */
function hasSignedInHint() {
  return /(?:^|;\s*)nf_signed_in=1(?:;|$)/.test(document.cookie);
}
const subscribe = () => () => {};

/** False on the server and until the page is running, then whatever the hint says. */
export function useSignedIn() {
  return useSyncExternalStore(subscribe, hasSignedInHint, () => false);
}
