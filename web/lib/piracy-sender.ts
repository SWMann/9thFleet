import { createHash } from "node:crypto";

/**
 * The mark a report carries so that the line can count how many one sender
 * has sent today, without the fleet keeping anything that says who they are.
 *
 * The mark is four characters, worked out from the sender's network address
 * and the day. About sixty-five thousand addresses share each mark, so a mark
 * cannot be turned back into an address, and a sender's mark changes every
 * day. The database counts the mark and throws it away: it is never stored
 * with a report. The address itself is not sent anywhere or written down.
 */

/** The part of a network address that stands for one sender: an IPv4 address whole, the first half of an IPv6 one. */
export function senderKey(address: string | null | undefined): string {
  const first = (address ?? "").split(",")[0].trim().toLowerCase();
  if (first === "") return "unknown";
  // An IPv4 address written the IPv6 way.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(first);
  if (mapped) return mapped[1];
  if (!first.includes(":")) return first;

  // One household or one machine is usually given the whole second half of
  // an IPv6 address to choose from, so only the first half says who it is.
  const [head, tail = ""] = first.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === "" ? [] : tail.split(":");
  const filled = first.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return filled
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
}

/** The mark for a sender at this address on this day, 2026-10-13. */
export function senderMark(address: string | null | undefined, day: string): string {
  return createHash("sha256").update(`${day}|${senderKey(address)}`).digest("hex").slice(0, 4);
}
