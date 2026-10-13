// The piracy report line: what the form's checks let through, and the mark a
// report carries in place of anything about its sender.

import assert from "node:assert/strict";
import { test } from "node:test";
import { discordPlain } from "./discord-text";
import { readReport, responseStart } from "./piracy-form";
import { senderKey, senderMark } from "./piracy-sender";

const TODAY = "2026-10-13";
const filled = (fields: Record<string, string> = {}) => {
  const all: Record<string, string> = {
    reporter_handle: "Lost_Miner",
    location: "Stanton, the ring at Yela",
    details: "Two ships jumped my Prospector while it was mining.",
    ...fields,
  };
  return readReport((name) => all[name] ?? "", TODAY);
};
const problem = (fields: Record<string, string>) => {
  const read = filled(fields);
  return "problem" in read ? read.problem : null;
};
const fields = (given: Record<string, string> = {}) => {
  const read = filled(given);
  if ("problem" in read) throw new Error(read.problem);
  return read.fields;
};

test("a report with the least it needs goes through, dated today", () => {
  assert.deepEqual(fields(), {
    urgent: false,
    reporter_handle: "Lost_Miner",
    location: "Stanton, the ring at Yela",
    happened_on: TODAY,
    suspect_kind: null,
    suspect_handle: "",
    details: "Two ships jumped my Prospector while it was mining.",
    evidence: "",
  });
});

test("names are the game's: a handle, not a sentence or an address", () => {
  for (const handle of ["", "x", "has space", "someone@example.com", "x".repeat(61)]) {
    assert.match(problem({ reporter_handle: handle }) ?? "", /your handle/, handle);
  }
  assert.match(problem({ suspect_kind: "individual", suspect_handle: "has space" }) ?? "", /their name/);
  assert.equal(fields({ suspect_kind: "organisation", suspect_handle: "RED-FLAG_9" }).suspect_handle, "RED-FLAG_9");
});

test("who did it is a kind and a name together, or neither", () => {
  assert.match(problem({ suspect_kind: "individual" }) ?? "", /Give their handle or organisation ID/);
  assert.match(problem({ suspect_handle: "Red_Raider" }) ?? "", /a player or an organisation/);
  assert.match(problem({ suspect_kind: "unknown", suspect_handle: "Red_Raider" }) ?? "", /a player or an organisation/);
  const known = fields({ suspect_kind: "individual", suspect_handle: "Red_Raider" });
  assert.equal(known.suspect_kind, "individual");
  assert.equal(fields({ suspect_kind: "unknown" }).suspect_kind, null);
});

test("the place is one tidy line", () => {
  assert.equal(fields({ location: "  Pyro,\t  near   Ruin Station " }).location, "Pyro, near Ruin Station");
  assert.match(problem({ location: "x" }) ?? "", /where it happened/);
  assert.match(problem({ location: "x".repeat(121) }) ?? "", /under 120/);
  assert.match(problem({ location: `Over${String.fromCharCode(0x202e)}ride` }) ?? "", /plain letters/);
  assert.match(problem({ location: `No${String.fromCharCode(0x200b)}width` }) ?? "", /plain letters/);
  // A line separator is white space, so it is tidied into a space like any other.
  assert.equal(fields({ location: `Two${String.fromCharCode(0x2028)}lines` }).location, "Two lines");
  // The place may become an event's title, so it is words and not a web address.
  for (const place of ["https://evil.example/free-ship", "[Yela](https://evil.example)", "see www.evil.example"]) {
    assert.match(problem({ location: place }) ?? "", /in words/, place);
  }
  // A place written right to left keeps the mark that says so.
  const marked = `Pyro ${String.fromCharCode(0x200f)}gate`;
  assert.equal(fields({ location: marked }).location, marked);
});

test("the day is today when left empty or happening now, and within the last 90 days", () => {
  assert.equal(fields({ happened_on: "2026-10-01" }).happened_on, "2026-10-01");
  assert.equal(fields({ happened_on: "2026-10-01", urgent: "on" }).happened_on, TODAY);
  assert.equal(fields({ urgent: "on" }).urgent, true);
  // Tomorrow is today somewhere ahead of UTC.
  assert.equal(fields({ happened_on: "2026-10-14" }).happened_on, "2026-10-14");
  assert.match(problem({ happened_on: "2026-10-15" }) ?? "", /in the future/);
  assert.equal(fields({ happened_on: "2026-07-15" }).happened_on, "2026-07-15");
  assert.match(problem({ happened_on: "2026-07-14" }) ?? "", /last 90 days/);
  for (const day of ["yesterday", "13/10/2026", "2026-13-40"]) assert.match(problem({ happened_on: day }) ?? "", /as a date/, day);
});

test("what happened is plain words, with its line breaks kept", () => {
  assert.equal(
    fields({ details: "They opened fire.\t No warning.  \n\n\n\nI lost the ship  \n and the cargo." }).details,
    "They opened fire. No warning.\n\nI lost the ship\nand the cargo.",
  );
  assert.match(problem({ details: "Too short." }) ?? "", /a sentence or more/);
  // What counts is what is not space.
  assert.match(problem({ details: "a b c d e f g h i j k l m n" }) ?? "", /a sentence or more/);
  assert.equal(fields({ details: "Shot at near Yela." }).details, "Shot at near Yela.");
  assert.match(problem({ details: String.fromCharCode(0x200b).repeat(30) }) ?? "", /plain text/);
  assert.match(problem({ details: `A word joiner ${String.fromCharCode(0x2060)} in the middle of the words.` }) ?? "", /plain text/);
  assert.match(problem({ details: "x".repeat(2001) }) ?? "", /2,000 characters/);
  // The joiners that emoji and some scripts are written with are ordinary writing.
  const family = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(String.fromCharCode(0x200d));
  assert.ok(fields({ details: `A family ${family} of pirates took everything.` }).details.includes(family));
  assert.match(problem({ details: `An over${String.fromCharCode(0x202e)}ride in the middle of the words.` }) ?? "", /plain text/);
  assert.match(problem({ details: `A bell ${String.fromCharCode(7)} in the middle of the words.` }) ?? "", /plain text/);
  // Marks that would be formatting elsewhere are only marks here.
  const marked = "*Not bold*, <b>not markup</b>, [not a link](https://example.com) and @nobody.";
  assert.equal(fields({ details: marked }).details, marked);
});

test("evidence is web addresses, one to a line", () => {
  assert.equal(fields({ evidence: "https://example.com/clip\n\nHTTPS://example.com/shot.png" }).evidence, "https://example.com/clip\nhttps://example.com/shot.png");
  assert.match(problem({ evidence: "see my stream" }) ?? "", /web address/);
  assert.match(problem({ evidence: "javascript:alert(1)" }) ?? "", /web address/);
  assert.match(problem({ evidence: `https://example.com/${String.fromCharCode(0x202e)}gnp.exe` }) ?? "", /plain web address/);
});

test("a Response event starts from where it happened, and does not name who sent the report", () => {
  assert.deepEqual(responseStart({ location: "Stanton, the ring at Yela" }), {
    title: "Piracy at Stanton, the ring at Yela",
    summary: "Answering a piracy report sent to the fleet.",
    area: "Stanton, the ring at Yela",
  });
  const long = responseStart({ location: "x".repeat(120) });
  assert.ok(long.title.length <= 80);
  assert.equal(long.area.length, 120);
});

test("a sender's key is their address, or the first half of a long one", () => {
  assert.equal(senderKey("203.0.113.7"), "203.0.113.7");
  assert.equal(senderKey("203.0.113.7, 10.0.0.1"), "203.0.113.7");
  assert.equal(senderKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(senderKey("2001:0db8:85a3:0000:1111:2222:3333:4444"), "2001:db8:85a3:0");
  assert.equal(senderKey("2001:db8:85a3::8a2e:370:7334"), "2001:db8:85a3:0");
  assert.equal(senderKey("2001:DB8::1"), "2001:db8:0:0");
  assert.equal(senderKey("::1"), "0:0:0:0");
  for (const none of [null, undefined, "", "  "]) assert.equal(senderKey(none), "unknown");
});

test("a sender's mark is four characters, the same all day and different the next", () => {
  const mark = senderMark("203.0.113.7", "2026-10-13");
  assert.match(mark, /^[a-f0-9]{4}$/);
  assert.equal(senderMark("203.0.113.7", "2026-10-13"), mark);
  assert.notEqual(senderMark("203.0.113.7", "2026-10-14"), mark);
  assert.notEqual(senderMark("203.0.113.8", "2026-10-13"), mark);
  // Two machines in one household's half of a long address are one sender.
  assert.equal(senderMark("2001:db8:85a3::1", "2026-10-13"), senderMark("2001:db8:85a3:0:ffff::2", "2026-10-13"));
  assert.match(senderMark(null, "2026-10-13"), /^[a-f0-9]{4}$/);
});

test("words posted to Discord hold no formatting, no mention and no link", () => {
  assert.equal(discordPlain("Piracy at Stanton, the ring at Yela"), "Piracy at Stanton, the ring at Yela");
  assert.equal(discordPlain("**Bold** _and_ ~~struck~~ `code` ||hidden|| > quote # heading"), "Bold and struck code hidden quote heading");
  assert.equal(discordPlain("@everyone and <@123> and <#456>"), "everyone and 123 and 456");
  // A link written Discord's way is taken apart, and an address loses the start that would make it one.
  assert.equal(discordPlain("[Stanton, Yela](https://evil.example/free-ship)"), "Stanton, Yela(evil.example/free-ship)");
  assert.equal(discordPlain("Meet at https://evil.example now"), "Meet at evil.example now");
  assert.equal(discordPlain("HTTP://EVIL.example and www.evil.example and discord://x"), "EVIL.example and evil.example and x");
  assert.equal(discordPlain("<https://evil.example>"), "evil.example");
  assert.equal(discordPlain("  spaced \n out  "), "spaced out");
  // An ordinary title is left as it is.
  assert.equal(discordPlain("Patrol 014 (Stanton): gate to gate, 19:00"), "Patrol 014 (Stanton): gate to gate, 19:00");
});
