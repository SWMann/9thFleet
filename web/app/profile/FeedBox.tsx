"use client";

import { useActionState, useState } from "react";
import { renewFeedKey, type FeedResult } from "./actions";

const untouched: FeedResult = { ok: false, message: "" };

/**
 * The member's calendar address, to paste into a calendar app, and a button
 * for a new one. The address is a secret of the member's: anyone who has it
 * reads their events until they make a new one.
 */
export function FeedBox({ address }: { address: string | null }) {
  const [result, action, pending] = useActionState(renewFeedKey, untouched);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="feed-box">
      {address ? (
        <>
          <p className="hint" id="feed_hint">
            Subscribe to this address in Google Calendar, Apple Calendar or Outlook (&ldquo;from URL&rdquo;), and every announced event appears with your reply, kept up to date.
            Keep it to yourself: anyone who has it sees your events.
          </p>
          <div className="feed-address">
            <input id="feed_address" type="text" readOnly value={address} aria-describedby="feed_hint" aria-label="Your calendar address" onFocus={(event) => event.currentTarget.select()} />
            <button className="button button-quiet button-small" type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <p className="hint">A private address for your calendar app: every announced event, with your reply, kept up to date. Make one to see it.</p>
      )}
      <form action={action} className="inline-form">
        <button className="button button-quiet button-small" type="submit" disabled={pending}>
          {pending ? "Making" : address ? "Make a new address" : "Make my calendar address"}
        </button>
        {result.message ? (
          <p className={result.ok ? "form-result" : "form-result form-result-bad"} role="status">
            {result.message}
          </p>
        ) : null}
      </form>
      {address ? <p className="hint">Making a new address stops the old one working, which is what to do if it was shared by mistake.</p> : null}
    </div>
  );
}
