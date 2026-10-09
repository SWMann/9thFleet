import { isCalloutKind, mentionKinds, type Block, type Inline, type MentionKind } from "./format";

/**
 * Formatted text to and from the editor's own document.
 *
 * The editor holds a document of nodes and marks. The site keeps Markdown.
 * This file is the step between the editor's document and the tree in
 * format.ts. It is plain data in and out, so it is tested without a browser.
 */

export type Mark = { type: string; attrs?: Record<string, unknown> };
export type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Mark[] };

const markOf: Record<"strong" | "emphasis" | "delete", string> = { strong: "bold", emphasis: "italic", delete: "strike" };

function inlineNodes(nodes: Inline[], marks: Mark[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (node.value !== "") out.push(marks.length > 0 ? { type: "text", text: node.value, marks } : { type: "text", text: node.value });
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "code":
        if (node.value !== "") out.push({ type: "text", text: node.value, marks: [...marks, { type: "code" }] });
        break;
      case "link":
        out.push(...inlineNodes(node.children, [...marks.filter((mark) => mark.type !== "link"), { type: "link", attrs: { href: node.href } }]));
        break;
      case "mention":
        // A name can be in bold, or inside a link's words, like any other word.
        out.push({ type: "mention", attrs: { id: node.id, label: node.label, kind: node.kind }, ...(marks.length > 0 ? { marks } : {}) });
        break;
      default:
        out.push(...inlineNodes(node.children, marks.some((mark) => mark.type === markOf[node.type]) ? marks : [...marks, { type: markOf[node.type] }]));
    }
  }
  return out;
}

function blockNodes(blocks: Block[]): Node[] {
  return blocks.map((block): Node => {
    switch (block.type) {
      case "paragraph":
        return { type: "paragraph", content: inlineNodes(block.children, []) };
      case "heading":
        // A heading is one line, so a line break in one is a space.
        return {
          type: "heading",
          attrs: { level: block.level === 1 ? 2 : 3 },
          content: inlineNodes(
            block.children.map((node): Inline => (node.type === "break" ? { type: "text", value: " " } : node)),
            [],
          ),
        };
      case "list":
        return {
          type: block.ordered ? "orderedList" : "bulletList",
          ...(block.ordered ? { attrs: { start: block.start } } : {}),
          // An item always opens with a paragraph, which is what the editor expects of one.
          content: block.items.map((item) => {
            const inside = blockNodes(item);
            return { type: "listItem", content: inside[0]?.type === "paragraph" ? inside : [{ type: "paragraph" }, ...inside] };
          }),
        };
      case "quote":
        return { type: "blockquote", content: filled(blockNodes(block.children)) };
      case "callout":
        return { type: "callout", attrs: { kind: block.kind }, content: filled(blockNodes(block.children)) };
      case "rule":
        return { type: "horizontalRule" };
    }
  });
}

const filled = (nodes: Node[]): Node[] => (nodes.length > 0 ? nodes : [{ type: "paragraph" }]);

/** The editor's document for a piece of formatted text. With `line`, only what fits in a line: paragraphs. */
export function toDoc(blocks: Block[], line = false): Node {
  if (!line) return { type: "doc", content: filled(blockNodes(blocks)) };
  const paragraphs: Node[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.type === "paragraph" || block.type === "heading") paragraphs.push({ type: "paragraph", content: inlineNodes(block.children, []) });
      else if (block.type === "list") block.items.forEach(walk);
      else if (block.type === "quote" || block.type === "callout") walk(block.children);
    }
  };
  walk(blocks);
  return { type: "doc", content: filled(paragraphs) };
}

type Piece = { node: Node; marks: Set<string>; href: string | null };

const WRAPPERS = ["link", "bold", "italic", "strike"] as const;
const wrapperType = { bold: "strong", italic: "emphasis", strike: "delete" } as const;

/** Runs of text that share a mark become one piece of bold, italic or the like, each inside the last. */
function wrap(pieces: Piece[], order: readonly (typeof WRAPPERS)[number][]): Inline[] {
  if (order.length === 0) {
    return pieces.map(({ node, marks }): Inline => {
      if (node.type === "hardBreak") return { type: "break" };
      if (node.type === "mention") {
        const attrs = node.attrs ?? {};
        const kind = mentionKinds.includes(attrs.kind as MentionKind) ? (attrs.kind as MentionKind) : "member";
        return { type: "mention", kind, id: String(attrs.id ?? ""), label: String(attrs.label ?? "") };
      }
      return marks.has("code") ? { type: "code", value: node.text ?? "" } : { type: "text", value: node.text ?? "" };
    });
  }
  const [mark, ...rest] = order;
  const key = (piece: Piece) => (mark === "link" ? piece.href : piece.marks.has(mark) ? "on" : null);
  const out: Inline[] = [];
  for (let at = 0; at < pieces.length; ) {
    const here = key(pieces[at]);
    let end = at + 1;
    while (end < pieces.length && key(pieces[end]) === here) end += 1;
    const run = pieces.slice(at, end);
    at = end;
    if (here === null) out.push(...wrap(run, rest));
    else if (mark === "link") out.push({ type: "link", href: here, children: wrap(run, rest) });
    else {
      // Markdown cannot open or close bold on a space, so the spaces at each end of the run are left outside it.
      const { lead, core, tail } = trimmed(run);
      if (lead) out.push({ type: "text", value: lead });
      if (core.length > 0) out.push({ type: wrapperType[mark], children: wrap(core, rest) });
      if (tail) out.push({ type: "text", value: tail });
    }
  }
  return out;
}

/** A run of pieces without the spaces at its two ends, and those spaces. */
function trimmed(run: Piece[]): { lead: string; core: Piece[]; tail: string } {
  const core = run.map((piece) => ({ ...piece, node: { ...piece.node } }));
  let lead = "";
  let tail = "";
  while (core.length > 0 && core[0].node.type === "text") {
    const text = core[0].node.text ?? "";
    const spaces = /^\s*/.exec(text)?.[0] ?? "";
    lead += spaces;
    if (spaces.length < text.length) {
      core[0].node.text = text.slice(spaces.length);
      break;
    }
    core.shift();
  }
  while (core.length > 0 && core[core.length - 1].node.type === "text") {
    const last = core[core.length - 1];
    const text = last.node.text ?? "";
    const spaces = /\s*$/.exec(text)?.[0] ?? "";
    tail = spaces + tail;
    if (spaces.length < text.length) {
      last.node.text = text.slice(0, text.length - spaces.length);
      break;
    }
    core.pop();
  }
  return { lead, core, tail };
}

function inlinesOf(content: Node[] | undefined): Inline[] {
  const pieces: Piece[] = [];
  for (const node of content ?? []) {
    if (node.type === "hardBreak") {
      pieces.push({ node, marks: new Set(), href: null });
      continue;
    }
    if (node.type !== "text" && node.type !== "mention") continue;
    if (node.type === "text" && (node.text ?? "") === "") continue;
    const marks = new Set((node.marks ?? []).map((mark) => mark.type));
    const link = (node.marks ?? []).find((mark) => mark.type === "link");
    const href = link ? String(link.attrs?.href ?? "") : null;
    pieces.push({ node: node.type === "text" ? { type: "text", text: node.text } : { type: "mention", attrs: node.attrs }, marks, href });
  }
  // A break at the very start or end of a paragraph is the editor's own, and says nothing.
  while (pieces[0]?.node.type === "hardBreak") pieces.shift();
  while (pieces.at(-1)?.node.type === "hardBreak") pieces.pop();
  return tidy(mergeText(wrap(pieces, WRAPPERS)));
}

/** A line does not begin or end with spaces: not the paragraph, and not either side of a line break in it. */
function tidy(nodes: Inline[]): Inline[] {
  const out = nodes.map((node) => ({ ...node }));
  out.forEach((node, index) => {
    if (node.type !== "text") return;
    const before = out[index - 1];
    const after = out[index + 1];
    if (!before || before.type === "break") node.value = node.value.replace(/^\s+/, "");
    if (!after || after.type === "break") node.value = node.value.replace(/\s+$/, "");
  });
  return out.filter((node) => node.type !== "text" || node.value !== "");
}

/** Text that sits side by side is one run of text. */
function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else if ("children" in node) out.push({ ...node, children: mergeText(node.children) });
    else out.push({ ...node });
  }
  return out;
}

function blocksOf(content: Node[] | undefined): Block[] {
  const out: Block[] = [];
  for (const node of content ?? []) {
    switch (node.type) {
      case "paragraph": {
        const children = inlinesOf(node.content);
        if (children.length > 0) out.push({ type: "paragraph", children });
        break;
      }
      case "heading": {
        // A heading is one line, so a line break typed into one is a space.
        const line = inlinesOf((node.content ?? []).map((child) => (child.type === "hardBreak" ? { type: "text", text: " " } : child)));
        if (line.length > 0) out.push({ type: "heading", level: Number(node.attrs?.level ?? 2) <= 2 ? 1 : 2, children: line });
        break;
      }
      case "bulletList":
      case "orderedList":
        out.push({
          type: "list",
          ordered: node.type === "orderedList",
          start: Number(node.attrs?.start ?? 1) || 1,
          items: (node.content ?? []).map((item) => blocksOf(item.content)).filter((item) => item.length > 0),
        });
        break;
      case "blockquote":
        out.push({ type: "quote", children: blocksOf(node.content) });
        break;
      case "callout":
        // The kind is one of the three. Anything else, such as one pasted in from another page, is a note.
        out.push({ type: "callout", kind: isCalloutKind(node.attrs?.kind) ? node.attrs.kind : "note", children: blocksOf(node.content) });
        break;
      case "horizontalRule":
        out.push({ type: "rule" });
        break;
    }
  }
  // A list, a quote or a box with nothing in it is nothing.
  return out.filter((block) => {
    if (block.type === "list") return block.items.length > 0;
    if (block.type === "quote" || block.type === "callout") return block.children.length > 0;
    return true;
  });
}

/** The formatted text an editor's document holds. */
export const fromDoc = (doc: Node): Block[] => blocksOf(doc.content);
