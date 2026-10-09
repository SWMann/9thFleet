/**
 * Formatted text: what the site's long text fields hold.
 *
 * The words are kept as Markdown in the same columns that held plain text, so
 * everything written before still reads as it did. On top of the usual
 * Markdown there are three things of the fleet's own:
 *
 *   A mention      [@Ada Vance](member:1b9d6bcd-…)   a member, a unit or a post
 *   A call-out     > [!WARNING]                      a box: warning, note or codeword
 *                  > Weapons tight until the word.
 *   A time         19:30Z or 1930Z                   shown to each reader in their own time too
 *
 * This file is the format as a tree, with nothing of Markdown in it. The
 * reader's page, the editor and the plain-text version all work from the tree.
 */

export type MentionKind = "member" | "unit" | "post";
export const mentionKinds: MentionKind[] = ["member", "unit", "post"];

export type CalloutKind = "warning" | "note" | "codeword";
export const callouts: { kind: CalloutKind; label: string; about: string }[] = [
  { kind: "warning", label: "Warning", about: "Something that will hurt the plan if it is missed." },
  { kind: "note", label: "Note", about: "Something worth knowing that is not an order." },
  { kind: "codeword", label: "Codeword", about: "A word and what it means when it is given." },
];
export const calloutLabel = (kind: CalloutKind) => callouts.find((entry) => entry.kind === kind)?.label ?? "Note";
export const isCalloutKind = (value: unknown): value is CalloutKind => callouts.some((entry) => entry.kind === value);

export type Inline =
  | { type: "text"; value: string }
  | { type: "break" }
  | { type: "strong" | "emphasis" | "delete"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "mention"; kind: MentionKind; id: string; label: string };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  /** Two sizes of heading and no more: a heading, and one under it. */
  | { type: "heading"; level: 1 | 2; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; children: Block[] }
  | { type: "callout"; kind: CalloutKind; children: Block[] }
  | { type: "rule" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address a mention is kept under, such as member:1b9d6bcd-…. */
export const mentionAddress = (kind: MentionKind, id: string) => `${kind}:${id}`;

/** A mention's kind and id from its address, or nothing if it is not one. */
export function readMention(address: string): { kind: MentionKind; id: string } | null {
  const at = address.indexOf(":");
  if (at < 0) return null;
  const kind = address.slice(0, at) as MentionKind;
  const id = address.slice(at + 1);
  return mentionKinds.includes(kind) && UUID.test(id) ? { kind, id: id.toLowerCase() } : null;
}

/** A stand-in for this site's own address, to see where an address would really lead. */
const HERE = "https://here.invalid";

/**
 * An address that is safe to link to: a page of this site, a web page or an
 * email address. Anything else, such as a script, is refused.
 *
 * A browser forgives a great deal in an address: it drops tabs and line
 * breaks, and reads a backslash as a slash. So "/\evil.example" looks like a
 * page of this site and leads away from it. An address with a space, a control
 * character or a backslash anywhere in it is refused outright, and one that
 * claims to be a page of this site is resolved the way a browser would, to
 * check that it is.
 */
export function safeHref(address: string): string | null {
  const href = address.trim();
  if (href === "" || /[\u0000-\u0020\u007f-\u009f\\]/.test(href)) return null;
  try {
    if (href.startsWith("/") || href.startsWith("#")) return new URL(href, HERE).origin === HERE ? href : null;
    if (/^https?:\/\//i.test(href)) return ["http:", "https:"].includes(new URL(href).protocol) ? href : null;
    if (/^mailto:[^@/?#]+@[^@/?#]+$/i.test(href)) return href;
  } catch {
    return null;
  }
  return null;
}

/** Whether a link leaves this site. */
export const isOutside = (href: string) => /^https?:/i.test(href);

/**
 * A time of day in UTC, written the way the fleet writes it: 19:30Z or 1930Z.
 * It must stand on its own, not inside a longer word or number.
 */
const ZULU = /(?<![\w:.])([01]\d|2[0-3]):?([0-5]\d)Z(?![\w])/g;

export type Zulu = { text: string; hour: number; minute: number };

/** A run of text as the pieces between its times, and the times. */
export function splitTimes(value: string): (string | Zulu)[] {
  const pieces: (string | Zulu)[] = [];
  let last = 0;
  for (const match of value.matchAll(ZULU)) {
    const at = match.index ?? 0;
    if (at > last) pieces.push(value.slice(last, at));
    pieces.push({ text: match[0], hour: Number(match[1]), minute: Number(match[2]) });
    last = at + match[0].length;
  }
  if (last < value.length) pieces.push(value.slice(last));
  return pieces;
}

/** Where each time sits in a run of text, for the editor to mark. */
export function findTimes(value: string): { from: number; to: number }[] {
  return [...value.matchAll(ZULU)].map((match) => ({ from: match.index ?? 0, to: (match.index ?? 0) + match[0].length }));
}

const inlineText = (nodes: Inline[]): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.value;
        case "break":
          return "\n";
        case "mention":
          return `@${node.label}`;
        default:
          return inlineText(node.children);
      }
    })
    .join("");

/** The words alone, for places that cannot show formatting: a log line, a page's description. */
export function plainOf(blocks: Block[]): string {
  const lines: string[] = [];
  const walk = (list: Block[], before: string) => {
    for (const block of list) {
      switch (block.type) {
        case "paragraph":
        case "heading":
          lines.push(before + inlineText(block.children));
          break;
        case "list":
          block.items.forEach((item, index) => walk(item, `${before}${block.ordered ? `${block.start + index}.` : "-"} `));
          break;
        case "quote":
          walk(block.children, before);
          break;
        case "callout":
          walk(block.children, `${before}${calloutLabel(block.kind)}: `);
          break;
        case "rule":
          break;
      }
    }
  };
  walk(blocks, "");
  return lines.join("\n").trim();
}

/**
 * Every word and nothing else: no spaces, no line breaks, no marks of a list or
 * a box. Two pieces of text with the same words have the same answer here
 * however they are laid out, which is how the editor checks that it has not
 * lost any.
 */
export function wordsOf(blocks: Block[]): string {
  const parts: string[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.type === "paragraph" || block.type === "heading") parts.push(inlineText(block.children));
      else if (block.type === "list") block.items.forEach(walk);
      else if (block.type === "quote" || block.type === "callout") walk(block.children);
    }
  };
  walk(blocks);
  return parts.join("").replace(/\s+/g, "");
}

/** Whether there is anything to read. */
export const isBlank = (blocks: Block[]) => plainOf(blocks) === "";
