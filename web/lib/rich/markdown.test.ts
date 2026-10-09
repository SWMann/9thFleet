// The format of formatted text: what is written comes back as it was, plain
// text from before still reads as it did, and nothing that could run is kept
// as anything but words.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findTimes, plainOf, safeHref, splitTimes, type Block } from "./format";
import * as markdown from "./markdown";
import { parseRich, plainText, writeRich } from "./markdown";

const MEMBER = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const again = (markdown: string) => writeRich(parseRich(markdown));
const types = (blocks: Block[]) => blocks.map((block) => block.type);

test("plain text from before reads as it was typed", () => {
  // A line break is a line break, and a gap between paragraphs is a gap.
  const blocks = parseRich("Form up at the gate.\nHold there.\n\nThen move on the word.");
  assert.deepEqual(types(blocks), ["paragraph", "paragraph"]);
  assert.equal(plainOf(blocks), "Form up at the gate.\nHold there.\nThen move on the word.");
  assert.equal(again("Form up at the gate.\nHold there.\n\nThen move on the word."), "Form up at the gate.\nHold there.\n\nThen move on the word.");

  // Lines that begin with spaces are not turned into a code block.
  assert.deepEqual(types(parseRich("    Indented by its writer.")), ["paragraph"]);
  assert.equal(plainText("    Indented by its writer."), "Indented by its writer.");
  // A line of dashes under a line of words does not make the words a heading.
  assert.deepEqual(types(parseRich("Phase one\n---\nPhase two")), ["paragraph", "rule", "paragraph"]);
  // A handle with underscores in it is left alone.
  assert.equal(again("Ask Kit_Marlow or Lee_T."), "Ask Kit_Marlow or Lee_T.");
  assert.equal(again("Weapons tight: fire only on a declared contact."), "Weapons tight: fire only on a declared contact.");
  assert.equal(again("Patrol the lane at 1900 UTC."), "Patrol the lane at 1900 UTC.");
});

test("nothing is read as a picture, as HTML or as a script", () => {
  const picture = parseRich("![a ship](https://example.com/ship.jpg)");
  assert.equal(JSON.stringify(picture).includes('"image"'), false);
  assert.match(plainOf(picture), /a ship/);

  const html = parseRich('<script>alert(1)</script> and <b onclick="x()">bold</b>');
  assert.deepEqual(types(html), ["paragraph"]);
  assert.match(plainOf(html), /<script>alert\(1\)<\/script> and <b onclick="x\(\)">bold<\/b>/);

  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref(" JaVaScript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("/manual/command/orders"), "/manual/command/orders");
  assert.equal(safeHref("https://robertsspaceindustries.com"), "https://robertsspaceindustries.com");
  assert.equal(safeHref("mailto:someone@example.com"), "mailto:someone@example.com");
});

test("every kind of formatting comes back as it was written", () => {
  const written = [
    "## Scheme of manoeuvre",
    "The **screen** leads, the *convoy* follows and ~~nobody~~ the escort closes the rear.",
    "### Order of march",
    "1. Screen\n2. Convoy\n3. Escort",
    "- Fuel at Baijini Point\n- Rearm before muster",
    "> Speed is the whole plan.",
    "---",
    "Read [the orders format](/manual/command/orders) first.",
  ].join("\n\n");
  assert.equal(again(written), written);
  assert.deepEqual(types(parseRich(written)), ["heading", "paragraph", "heading", "list", "list", "quote", "rule", "paragraph"]);
});

test("a mention names a member, a unit or a post, and anything else is a plain link", () => {
  const written = `Report to [@Ada Vance](member:${MEMBER}) on arrival.`;
  const [paragraph] = parseRich(written);
  assert.equal(paragraph.type, "paragraph");
  const mention = paragraph.type === "paragraph" ? paragraph.children.find((node) => node.type === "mention") : null;
  assert.deepEqual(mention, { type: "mention", kind: "member", id: MEMBER, label: "Ada Vance" });
  assert.equal(again(written), written);
  assert.equal(plainText(written), "Report to @Ada Vance on arrival.");

  // An address that only looks like one is not a mention, and is not kept as a link either.
  const odd = parseRich("[@Someone](member:not-an-id) and [x](admin:1)");
  assert.equal(JSON.stringify(odd).includes('"mention"'), false);
  assert.equal(JSON.stringify(odd).includes('"link"'), false);
  assert.equal(again("[@Someone](member:not-an-id) and [x](admin:1)"), "@Someone and x");
  // Above all, one that would run something.
  assert.equal(again("[click here](javascript:alert(1)) and [this](JAVASCRIPT:alert(1))"), "click here and this");
  assert.equal(again("[data](data:text/html,<script>alert(1)</script>)"), "data");
});

test("a call-out is a box of its kind, and holds whatever a quote can", () => {
  const written = "> [!WARNING]\n> Weapons tight until the word.\n>\n> - Check fire on **Baker**\n> - Call it on the command net";
  const [box] = parseRich(written);
  assert.equal(box.type, "callout");
  assert.equal(box.type === "callout" ? box.kind : null, "warning");
  assert.deepEqual(box.type === "callout" ? types(box.children) : [], ["paragraph", "list"]);
  assert.equal(again(written), written);
  assert.equal(plainText("> [!CODEWORD]\n> THUNDER: break off and re-form."), "Codeword: THUNDER: break off and re-form.");
  // The same line is one too, as some write it.
  assert.equal(parseRich("> [!note] Fuel is short.")[0].type, "callout");
  // A quote that is only a quote stays one.
  assert.equal(parseRich("> Just a quote.")[0].type, "quote");
});

test("a time in UTC is found where it stands on its own", () => {
  assert.deepEqual(splitTimes("Muster 19:30Z, step off 2000Z."), [
    "Muster ",
    { text: "19:30Z", hour: 19, minute: 30 },
    ", step off ",
    { text: "2000Z", hour: 20, minute: 0 },
    ".",
  ]);
  assert.deepEqual(findTimes("At 0005Z."), [{ from: 3, to: 8 }]);
  // Not an hour that does not exist, and not part of something longer.
  for (const not of ["25:00Z", "19:75Z", "A1930Z", "1930Zulu", "121930Z", "v1.19:30Z"]) {
    assert.deepEqual(findTimes(not), [], not);
  }
});

test("words that look like formatting are kept as the words they are", () => {
  for (const typed of [
    "Use 2 * 3 * 4 for the count.",
    "#1 priority is the convoy.",
    "Snake_case_words and *stars* around.",
    "A [bracket] and a <tag> and a back\\slash.",
    "1. not\n2. really",
    "- a line that starts with a dash",
    "> a line that starts with an arrow",
  ]) {
    // Whatever it is read as, writing it out and reading it again changes nothing more.
    const once = again(typed);
    assert.equal(again(once), once, typed);
    assert.equal(plainText(once), plainText(typed), typed);
  }
});

test("text written to break the reader is read as its plain words, quickly", () => {
  for (const hostile of [">".repeat(3999) + "x", "- ".repeat(1999) + "x", "1. ".repeat(1300) + "x", "> - ".repeat(999) + "x", `${"> ".repeat(40)}deep\n\nand a second paragraph`]) {
    const began = Date.now();
    const blocks = parseRich(hostile);
    assert.ok(Date.now() - began < 500, `reading took ${Date.now() - began}ms`);
    assert.ok(blocks.every((block) => block.type === "paragraph"), "nothing was read into it");
    assert.match(plainOf(blocks), /x$|second paragraph$/);
    // And it can be written out again without failing.
    assert.equal(typeof writeRich(blocks), "string");
  }
  // A dividing line of many dashes is still a dividing line.
  assert.deepEqual(types(parseRich("Above\n\n- - - - - - - - - - - -\n\nBelow")), ["paragraph", "rule", "paragraph"]);
});

test("lists and quotes inside one another are kept to a depth, and what is deeper is kept as words", () => {
  const nested = Array.from({ length: 12 }, (_, depth) => `${"  ".repeat(depth)}- level ${depth + 1}`).join("\n");
  const depthOf = (blocks: Block[]): number =>
    Math.max(
      0,
      ...blocks.map((block) =>
        block.type === "list" ? 1 + Math.max(0, ...block.items.map(depthOf)) : block.type === "quote" || block.type === "callout" ? 1 + depthOf(block.children) : 0,
      ),
    );
  const blocks = parseRich(nested);
  assert.ok(depthOf(blocks) <= 6, `nested ${depthOf(blocks)} deep`);
  assert.match(plainOf(blocks), /level 12/, "the deepest words are still there");
  assert.ok(depthOf(parseRich("> ".repeat(8) + "quoted")) <= 6);
});

test("an address that only looks like a page of this site is refused", () => {
  for (const address of ["/\\evil.example/login", "\\\\evil.example", "/\t/evil.example", "/\n/evil.example", "//evil.example", "/ /evil.example", "https://exa mple.com", "http:evil", "mailto:", "mailto:a b@c.d"]) {
    assert.equal(safeHref(address), null, JSON.stringify(address));
  }
  // The same, however it is spelled in the Markdown: a browser would read each of these as another site.
  for (const written of ["[the rules](/\\evil.example/login)", "[x](/&#9;/evil.example)", "[x](/&NewLine;/evil.example)", "[x](&#47;&#47;evil.example)", "<javascript:alert(1)>"]) {
    assert.equal(JSON.stringify(parseRich(written)).includes('"link"'), false, written);
  }
  for (const address of ["/manual/command/orders", "/roles?area=gunnery#top", "#reply", "https://robertsspaceindustries.com/en/fankit", "mailto:someone@example.com"]) {
    assert.equal(safeHref(address), address);
  }
});

test("a web address is a link only where its writer made it one", () => {
  for (const typed of ["See www.example.com for more.", "See https://example.com/a_b for more.", "Write to someone@example.com today."]) {
    assert.equal(JSON.stringify(parseRich(typed)).includes('"link"'), false, typed);
    assert.equal(again(typed), typed);
  }
  const [paragraph] = parseRich("See <https://example.com/a_b> for more.");
  assert.equal(paragraph.type === "paragraph" && paragraph.children.some((node) => node.type === "link"), true);
});

test("a heading is one line, and a marker written to be read as words is not a box", () => {
  assert.equal(writeRich([{ type: "heading", level: 1, children: [{ type: "text", value: "Scheme" }, { type: "break" }, { type: "text", value: "of manoeuvre" }] }]), "## Scheme of manoeuvre");
  assert.equal(parseRich("> \\[!NOTE] not a box")[0].type, "quote");
  assert.equal(again("> \\[!NOTE] not a box"), "> \\[!NOTE] not a box");
});

test("a list item that holds more than a line reads back as it was", () => {
  for (const written of [
    "- item\n\n  > [!WARNING]\n  > boxed\n\n  para",
    "- item\n\n  > [!WARNING]\n  > one\n\n  > [!NOTE]\n  > two",
    "- item\n  - nested\n\n  after the nested list",
    "- item\n\n  3. third\n  4. fourth",
    "1. first\n   - under it\n2. second",
    "- item\n\n  > quoted\n\n  after the quote",
  ]) {
    const once = again(written);
    assert.equal(again(once), once, written);
    assert.deepEqual(JSON.parse(JSON.stringify(parseRich(once))), JSON.parse(JSON.stringify(parseRich(written))), written);
  }
  // The usual list inside a list is still written close up.
  assert.equal(again("- Fuel\n  - Missiles first\n  - Then guns\n- Rearm"), "- Fuel\n  - Missiles first\n  - Then guns\n- Rearm");
});

test("a mention can be taken out of text that visitors will read", () => {
  const { withoutMentions } = markdown;
  assert.equal(withoutMentions(`Ask [@Kit Marlow](member:${MEMBER}) about **it**.`), "Ask Kit Marlow about **it**.");
  assert.equal(withoutMentions("- [@A Flight](unit:" + MEMBER + ") leads"), "- A Flight leads");
  // Text with nobody named in it is left exactly as it was written.
  assert.equal(withoutMentions("Mans a turret  and *keeps* it firing."), "Mans a turret  and *keeps* it firing.");
});
