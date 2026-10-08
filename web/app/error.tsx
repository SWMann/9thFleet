"use client";

import { useEffect } from "react";

/** Shown when a page fails while it is being put together. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="wrap page-head page-plain">
      <h1>
        <strong>Unworkable.</strong>
      </h1>
      <p className="lead">Something went wrong on our side and this page could not be shown.</p>
      <p className="actions">
        <button className="button" type="button" onClick={() => retry()}>
          Try again
        </button>
      </p>
    </div>
  );
}
