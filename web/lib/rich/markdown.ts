import type { BlockContent, Blockquote, Link, List, ListItem, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { gfmStrikethroughFromMarkdown, gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified, type Processor } from "unified";
import { callouts, isCalloutKind, mentionAddress, plainOf, readMention, safeHref, type Block, type CalloutKind, type Inline } from "./format";

/**
 * Formatted text to and from the Markdown it is kept as.
 *
 * The Markdown is a small one. It has what the editor can make and nothing
 * else: no pictures, no HTML, no tables, no code blocks. Whatever is not part
 * of it is kept as the plain words that were typed, never dropped and never
 * run. A line break is a line break, as it was when these fields were plain.
 * A web address is a link only where its writer made it one.
 *
 * Text is written by people the site cannot vouch for, so reading it never
 * fails: text nested deeper than anyone would write by hand, or anything the
 * reader stumbles on, is given back as its plain words.
 */

/** The parts of Markdown that are switched off, so that text written as plain text still reads as it was typed. */
const SWITCHED_OFF = ["codeIndented", "htmlFlow", "htmlText", "definition", "setextUnderline", "labelStartImage"];

function fleetSyntax(this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
    toMarkdownExtensions?: unknown[];
  };
  (data.micromarkExtensions ??= []).push(gfmStrikethrough({ singleTilde: false }), { disable: { null: SWITCHED_OFF } });
  (data.fromMarkdownExtensions ??= []).push(gfmStrikethroughFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(gfmStrikethroughToMarkdown());
}

const reader = unified().use(remarkParse).use(fleetSyntax);
const writer = unified()
  .use(fleetSyntax)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    rule: "-",
    listItemIndent: "one",
    fences: true,
    incrementListMarker: true,
    // A line break is kept as a line break, as these fields have always kept it.
    handlers: { break: () => "\n" },
  });

const MARKER = /^\[!(WARNING|NOTE|CODEWORD)\][ \t]*/i;

/** Text with its line breaks as breaks. */
function textOf(value: string): Inline[] {
  const out: Inline[] = [];
  value.split("\n").forEach((line, index) => {
    if (index > 0) out.push({ type: "break" });
    if (line !== "") out.push({ type: "text", value: line });
  });
  return out;
}

const wordsOf = (nodes: PhrasingContent[]): string =>
  nodes.map((node) => ("value" in node ? node.value : "children" in node ? wordsOf(node.children as PhrasingContent[]) : "")).join("");

function inlinesOf(nodes: PhrasingContent[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(...textOf(node.value));
        break;
      case "break":
        out.push({ type: "break" });
        break;
      case "strong":
      case "emphasis":
      case "delete":
        out.push({ type: node.type, children: inlinesOf(node.children) });
        break;
      case "inlineCode":
        out.push({ type: "code", value: node.value });
        break;
      case "link": {
        const mention = readMention(node.url);
        const label = wordsOf(node.children);
        if (mention) out.push({ type: "mention", ...mention, label: label.replace(/^@/, "") });
        else if (safeHref(node.url)) out.push({ type: "link", href: node.url, children: inlinesOf(node.children) });
        // An address that is not safe to follow is not kept as a link at all. Its words stay.
        else out.push(...inlinesOf(node.children));
        break;
      }
      default:
        // Anything else is kept as the words it was written with.
        if ("value" in node && typeof node.value === "string") out.push(...textOf(node.value));
        else if ("children" in node) out.push(...inlinesOf(node.children as PhrasingContent[]));
    }
  }
  return out;
}

/** A quote that opens with [!WARNING] and the like is a call-out. This takes the marker off and says which. */
function calloutOf(quote: Blockquote, source: string): { kind: CalloutKind; children: RootContent[] } | null {
  const [first, ...rest] = quote.children;
  if (!first || first.type !== "paragraph") return null;
  const [lead, ...others] = first.children;
  if (!lead || lead.type !== "text") return null;
  const found = MARKER.exec(lead.value);
  if (!found) return null;
  // A marker written with a backslash before it was meant as words, not as a box.
  const at = lead.position?.start.offset;
  if (at !== undefined && source.charAt(at) !== "[") return null;
  const kind = found[1].toLowerCase();
  if (!isCalloutKind(kind)) return null;
  // What follows the marker on its own line is the first line of the box.
  const left = lead.value.slice(found[0].length).replace(/^\n/, "");
  const inside: PhrasingContent[] = [...(left ? [{ type: "text" as const, value: left }] : []), ...others];
  if (inside[0]?.type === "break") inside.shift();
  const children: RootContent[] = inside.length > 0 ? [{ ...first, children: inside }, ...rest] : rest;
  return { kind, children };
}

/** How deep a list, a quote or a box may sit inside others. Past this, what is inside is kept as its words. */
const DEEPEST = 6;

/** Every word under a node, a line to each block, for when its layout is not kept. */
function linesUnder(node: RootContent): string[] {
  if ("children" in node) {
    const children = node.children as RootContent[];
    const phrasing = children.every((child) => !("children" in child) || ["strong", "emphasis", "delete", "link"].includes(child.type));
    return phrasing ? [wordsOf(children as PhrasingContent[])] : children.flatMap(linesUnder);
  }
  return "value" in node && typeof node.value === "string" ? [node.value] : [];
}

/** A heading is one line. A line break in one is a space. */
const oneLine = (nodes: Inline[]): Inline[] => nodes.map((node) => (node.type === "break" ? { type: "text", value: " " } : node));

function blocksOf(nodes: RootContent[], source: string, depth: number): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    if (depth >= DEEPEST && (node.type === "list" || node.type === "blockquote")) {
      const words = linesUnder(node).filter((line) => line.trim() !== "");
      if (words.length > 0) out.push({ type: "paragraph", children: textOf(words.join("\n")) });
      continue;
    }
    switch (node.type) {
      case "paragraph": {
        const children = inlinesOf(node.children);
        if (children.length > 0) out.push({ type: "paragraph", children });
        break;
      }
      case "heading":
        out.push({ type: "heading", level: node.depth <= 2 ? 1 : 2, children: oneLine(inlinesOf(node.children)) });
        break;
      case "list":
        out.push({
          type: "list",
          ordered: node.ordered === true,
          start: node.start ?? 1,
          items: node.children.map((item) => blocksOf(item.children, source, depth + 1)),
        });
        break;
      case "blockquote": {
        const callout = calloutOf(node, source);
        if (callout) out.push({ type: "callout", kind: callout.kind, children: blocksOf(callout.children, source, depth + 1) });
        else out.push({ type: "quote", children: blocksOf(node.children, source, depth + 1) });
        break;
      }
      case "thematicBreak":
        out.push({ type: "rule" });
        break;
      case "code":
        // There are no code blocks. What was fenced is kept as its lines.
        if (node.value.trim() !== "") out.push({ type: "paragraph", children: textOf(node.value) });
        break;
      default:
        if ("value" in node && typeof node.value === "string" && node.value.trim() !== "") {
          out.push({ type: "paragraph", children: textOf(node.value) });
        }
    }
  }
  return out;
}

/** Text with no formatting read into it at all: a paragraph for each run of lines. */
function plainBlocks(text: string): Block[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => ({ type: "paragraph", children: textOf(chunk.replace(/[ \t]*\n[ \t]*/g, "\n")) }));
}

/** A dividing line written as spaced dashes or stars, which is many marks on a line and no nesting at all. */
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A line that opens with a run of list and quote marks: more of them than anyone nests by hand. */
const NESTED = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])){9}/;

/**
 * Whether text is nested so deeply that it was written to break the reader,
 * not to be read. Such text is not read as Markdown at all.
 */
const overNested = (text: string) => text.split("\n").some((line) => NESTED.test(line) && !RULE.test(line));

/**
 * Read formatted text from the Markdown it is kept as. It never fails:
 * whatever cannot be read as Markdown is read as its plain words.
 */
export function parseRich(markdown: string | null | undefined): Block[] {
  const text = (markdown ?? "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") return [];
  if (overNested(text)) return plainBlocks(text);
  try {
    return blocksOf((reader.parse(text) as Root).children, text, 0);
  } catch {
    return plainBlocks(text);
  }
}

function phrasingOf(nodes: Inline[]): PhrasingContent[] {
  return nodes.map((node): PhrasingContent => {
    switch (node.type) {
      case "text":
        return { type: "text", value: node.value };
      case "break":
        return { type: "break" };
      case "code":
        return { type: "inlineCode", value: node.value };
      case "link":
        return { type: "link", url: node.href, children: phrasingOf(node.children) as Link["children"] };
      case "mention":
        return { type: "link", url: mentionAddress(node.kind, node.id), children: [{ type: "text", value: `@${node.label}` }] };
      default:
        return { type: node.type, children: phrasingOf(node.children) };
    }
  });
}

function contentOf(blocks: Block[]): BlockContent[] {
  const out: BlockContent[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        if (block.children.length > 0) out.push({ type: "paragraph", children: phrasingOf(block.children) });
        break;
      case "heading":
        out.push({ type: "heading", depth: block.level === 1 ? 2 : 3, children: phrasingOf(oneLine(block.children)) });
        break;
      case "list": {
        const children = block.items.map((item): ListItem => {
          const inside = contentOf(item);
          // An item is written close up when it is a paragraph, or a paragraph and a list under it. Anything
          // more is set apart with blank lines, or the next block would be read as part of the one before.
          const [, second] = inside;
          const close =
            inside.length <= 1 ||
            (inside.length === 2 && inside[0].type === "paragraph" && second.type === "list" && (!second.ordered || (second.start ?? 1) === 1));
          return { type: "listItem", spread: !close, children: inside };
        });
        const list: List = { type: "list", ordered: block.ordered, start: block.ordered ? block.start : null, spread: false, children };
        if (children.length > 0) out.push(list);
        break;
      }
      case "quote":
        out.push({ type: "blockquote", children: contentOf(block.children) });
        break;
      case "callout": {
        // The marker is written as it stands, on a line of its own at the top of the box.
        const marker: PhrasingContent = { type: "html", value: `[!${block.kind.toUpperCase()}]` };
        const [first, ...rest] = contentOf(block.children);
        const lead: Paragraph =
          first?.type === "paragraph"
            ? { type: "paragraph", children: [marker, { type: "break" }, ...first.children] }
            : { type: "paragraph", children: [marker] };
        out.push({ type: "blockquote", children: first && first.type !== "paragraph" ? [lead, first, ...rest] : [lead, ...rest] });
        break;
      }
      case "rule":
        out.push({ type: "thematicBreak" });
        break;
    }
  }
  return out;
}

/** Write formatted text as the Markdown it is kept as. */
export function writeRich(blocks: Block[]): string {
  const root: Root = { type: "root", children: contentOf(blocks) };
  return writer.stringify(root).trim();
}

/** The words alone of a piece of formatted text. */
export const plainText = (markdown: string | null | undefined) => plainOf(parseRich(markdown));

/**
 * Formatted text with nobody and nothing named in it: each mention becomes the
 * name it showed. For a field that visitors can read, which should not hold
 * the id of a member.
 */
export function withoutMentions(markdown: string): string {
  const inline = (nodes: Inline[]): Inline[] =>
    nodes.map((node): Inline => {
      if (node.type === "mention") return { type: "text", value: node.label };
      return "children" in node ? { ...node, children: inline(node.children) } : node;
    });
  const block = (blocks: Block[]): Block[] =>
    blocks.map((entry): Block => {
      switch (entry.type) {
        case "paragraph":
        case "heading":
          return { ...entry, children: inline(entry.children) };
        case "list":
          return { ...entry, items: entry.items.map(block) };
        case "quote":
        case "callout":
          return { ...entry, children: block(entry.children) };
        default:
          return entry;
      }
    });
  const tree = parseRich(markdown);
  return JSON.stringify(tree).includes('"mention"') ? writeRich(block(tree)) : markdown;
}

/** The names of the call-out kinds, for whoever needs to list them. */
export const calloutKinds = callouts.map((entry) => entry.kind);
