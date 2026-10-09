// Formatted text through the editor's document and back: nothing is lost on
// the way in, and what the editor holds is written as Markdown that reads back the same.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fromDoc, toDoc, type Node } from "./doc";
import { parseRich, writeRich } from "./markdown";

const MEMBER = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const through = (markdown: string) => writeRich(fromDoc(toDoc(parseRich(markdown))));
const text = (value: string, ...marks: string[]): Node => ({ type: "text", text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const paragraph = (...content: Node[]): Node => ({ type: "paragraph", content });
const written = (...content: Node[]) => writeRich(fromDoc({ type: "doc", content }));

test("everything the format holds goes through the editor and comes back the same", () => {
  for (const markdown of [
    "Form up at the gate.\nHold there.\n\nThen move on the word.",
    "## Scheme\n\nThe **screen** leads, the *convoy* follows and ~~nobody~~ the escort closes.",
    "### Order of march\n\n1. Screen\n2. Convoy\n3. Escort",
    "- Fuel at Baijini Point\n- Rearm before muster\n  - Missiles first\n  - Then guns",
    "> Speed is the whole plan.",
    "> [!WARNING]\n> Weapons tight until the word.\n>\n> - Check fire on **Baker**",
    "> [!CODEWORD]\n> THUNDER: break off.",
    `Report to [@Ada Vance](member:${MEMBER}) at 19:30Z, then read [the orders](/manual/command/orders).`,
    "A **_bold and italic_** run, and `code`.",
    "One\n\n---\n\nTwo",
    "3. Starts at three\n4. And goes on",
  ]) {
    assert.equal(through(markdown), markdown, markdown);
  }
});

test("an empty editor is nothing, and empty paragraphs between others are dropped", () => {
  assert.equal(written(paragraph()), "");
  assert.equal(written({ type: "paragraph" }, paragraph(text("One")), { type: "paragraph" }, paragraph(text("Two"))), "One\n\nTwo");
  assert.deepEqual(toDoc([]), { type: "doc", content: [{ type: "paragraph" }] });
  // A box or a list with nothing in it is not kept.
  assert.equal(written({ type: "callout", attrs: { kind: "note" }, content: [{ type: "paragraph" }] }), "");
  assert.equal(written({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }), "");
});

test("marks that overlap, or end on a space, are written so that they read back", () => {
  // Bold that runs into bold italic is one piece of bold.
  const mixed = written(paragraph(text("Hold "), text("the ", "bold"), text("lane", "bold", "italic"), text(" now")));
  assert.equal(mixed, "Hold **the *lane*** now");
  assert.equal(through(mixed), mixed);
  // Bold cannot end on a space in Markdown, so the space is left outside it.
  assert.equal(written(paragraph(text("Weapons tight ", "bold"), text("until the word."))), "**Weapons tight** until the word.");
  assert.equal(written(paragraph(text("Go "), text(" now ", "italic"), text("please"))), "Go  *now* please");
  // A link keeps its formatting inside it.
  const linked: Node = { type: "text", text: "the orders", marks: [{ type: "link", attrs: { href: "/manual/command/orders" } }, { type: "bold" }] };
  assert.equal(written(paragraph(text("Read "), linked, text("."))), "Read [**the orders**](/manual/command/orders).");
  // Spaces left at the ends of a line are not kept, whatever was put in after them.
  assert.equal(written(paragraph(text("  Read the orders "), { type: "hardBreak" }, text(" then muster.  "))), "Read the orders\nthen muster.");
  assert.equal(written(paragraph(text("See "), linked, text(" "))), "See [**the orders**](/manual/command/orders)");
  // A line break inside a paragraph is a line break, and one left at the end is not kept.
  assert.equal(written(paragraph(text("One"), { type: "hardBreak" }, text("Two"), { type: "hardBreak" })), "One\nTwo");
});

test("a field that is one line holds only what fits in a line", () => {
  const doc = toDoc(parseRich("## A heading\n\n- One\n- Two\n\n> [!NOTE]\n> **Three**"), true);
  assert.deepEqual(
    (doc.content ?? []).map((node) => node.type),
    ["paragraph", "paragraph", "paragraph", "paragraph"],
  );
  assert.equal(writeRich(fromDoc(doc)), "A heading\n\nOne\n\nTwo\n\n**Three**");
});

test("a name or a piece of code keeps the bold, the italic or the link it sits in", () => {
  for (const markdown of [
    "See [`code`](/manual) for it.",
    "Run **`code`** now.",
    `Report to **[@Ada Vance](member:${MEMBER})** at once.`,
    `Read [the orders of @Ada Vance](/manual/command/orders).`,
  ]) {
    assert.equal(through(markdown), markdown, markdown);
  }
});

test("a heading typed over two lines is one line, and a line break that opens a paragraph is dropped", () => {
  const heading: Node = { type: "heading", attrs: { level: 2 }, content: [text("Scheme"), { type: "hardBreak" }, text("of manoeuvre")] };
  assert.equal(written(heading), "## Scheme of manoeuvre");
  assert.equal(through("## Scheme of manoeuvre"), "## Scheme of manoeuvre");
  const item: Node = { type: "listItem", content: [paragraph({ type: "hardBreak" }, text("Fuel"))] };
  assert.equal(written({ type: "bulletList", content: [item] }), "- Fuel");
  // A heading with nothing in it is not kept.
  assert.equal(written({ type: "heading", attrs: { level: 2 } }, paragraph(text("Words"))), "Words");
});

test("a box of a kind that does not exist is a note, whatever it was called", () => {
  const box: Node = { type: "callout", attrs: { kind: "note]\n\n# pwn\n\n[x" }, content: [paragraph(text("Pasted in."))] };
  assert.equal(written(box), "> [!NOTE]\n> Pasted in.");
  const named: Node = { type: "mention", attrs: { id: MEMBER, label: "Ada Vance", kind: "admin" } };
  assert.equal(written(paragraph(named)), `[@Ada Vance](member:${MEMBER})`);
});

test("text that was written to break the reader goes through the editor as its words", () => {
  for (const hostile of [">".repeat(3999) + "x", "- ".repeat(1999) + "x"]) {
    const doc = toDoc(parseRich(hostile));
    assert.equal(JSON.stringify(doc).length < 20000, true);
    assert.match(writeRich(fromDoc(doc)), /x$/);
  }
});
