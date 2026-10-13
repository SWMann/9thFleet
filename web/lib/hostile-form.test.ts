import assert from "node:assert/strict";
import { test } from "node:test";
import { lapses, linkLabel, readEvidence, readHostile, readName, readWords, standing } from "./hostile-form";

const form = (fields: Record<string, string>) => (name: string) => (fields[name] ?? "").trim();
const good = { kind: "individual", handle: "Red_Raider-7", name: "Known as Red", level: "watch", reason: "Attacked a mining ship at Yela.", evidence: "https://example.com/clip" };

test("a well-formed entry is read as it was written", () => {
  assert.deepEqual(readHostile(form(good)), {
    fields: { kind: "individual", handle: "Red_Raider-7", name: "Known as Red", level: "watch", reason: "Attacked a mining ship at Yela.", evidence: "https://example.com/clip" },
  });
  // The level is hostile unless watch is chosen, and a name and evidence may be left out.
  const bare = readHostile(form({ kind: "organisation", handle: "SCRUBS", reason: "Camped the Grim HEX pads for a week." }));
  assert.deepEqual(bare, { fields: { kind: "organisation", handle: "SCRUBS", name: "", level: "hostile", reason: "Camped the Grim HEX pads for a week.", evidence: "" } });
});

test("a handle is a name from the game and nothing else", () => {
  for (const handle of ["", "a", "Has Space", "semi;colon", "<b>", "x".repeat(61), "naïve", "https://x.example"]) {
    const read = readHostile(form({ ...good, handle }));
    assert.ok("problem" in read, handle);
    assert.match(read.problem, /RSI handle as the game shows it/);
  }
  const org = readHostile(form({ ...good, kind: "organisation", handle: "two words" }));
  assert.ok("problem" in org && /Organisation ID/.test(org.problem));
  assert.ok("problem" in readHostile(form({ ...good, kind: "ship" })));
  assert.ok("problem" in readHostile(form({ ...good, level: "kill" })));
});

test("what happened must be said, and kept to length", () => {
  assert.ok("problem" in readWords(form({ reason: "Bad." })));
  assert.ok("problem" in readWords(form({ reason: "x".repeat(2001) })));
  assert.ok("fields" in readWords(form({ reason: "x".repeat(2000) })));
  assert.ok("problem" in readHostile(form({ ...good, name: "x".repeat(81) })));
});

test("evidence is web addresses, one to a line", () => {
  assert.deepEqual(readEvidence("  https://example.com/a  \n\nhttp://example.org/b?c=d#e\n"), { lines: ["https://example.com/a", "http://example.org/b?c=d#e"] });
  assert.deepEqual(readEvidence(""), { lines: [] });
  for (const bad of ["not an address", "javascript:alert(1)", "file:///etc/passwd", "ftp://old.example/file", "https://one.example https://two.example", "//example.com/no-scheme", "https:example.com"]) {
    assert.ok("problem" in readEvidence(bad), bad);
    assert.ok("problem" in readEvidence(`https://fine.example\n${bad}`), bad);
  }
  assert.ok("problem" in readEvidence(`https://example.com/${"x".repeat(1000)}`));
  // The start of an address is kept in small letters, as the database asks, and an address is kept once.
  assert.deepEqual(readEvidence("HTTPS://Example.com/A\nhttps://Example.com/A\nHttp://example.org/b"), { lines: ["https://Example.com/A", "http://example.org/b"] });
});

test("a name is one plain line", () => {
  assert.equal(readName("  The   Scrub Collective "), "The Scrub Collective");
  assert.equal(readName(""), "");
  for (const bad of ["over\u202eride", "iso\u2066late", "bell\u0007", "x".repeat(81)]) {
    assert.ok(typeof readName(bad) !== "string", JSON.stringify(bad));
  }
  assert.ok("problem" in readHostile(form({ ...good, name: "over\u202eride" })));
});

test("what happened is more than spaces", () => {
  assert.ok("problem" in readWords((name) => (name === "reason" ? "          " : "")));
  assert.ok("problem" in readWords((name) => (name === "reason" ? "   short   " : "")));
});

test("only a declared hostile organisation stands without a last day", () => {
  assert.equal(lapses("organisation", "hostile"), false);
  assert.equal(lapses("organisation", "watch"), true);
  assert.equal(lapses("individual", "hostile"), true);
  assert.equal(lapses("individual", "watch"), true);
});

test("an entry says how long it has left, and when it has lapsed", () => {
  assert.deepEqual(standing(null, "2026-10-13"), { lapsed: false, soon: false, daysLeft: null, words: "Until lifted" });
  assert.deepEqual(standing("2027-01-11", "2026-10-13"), { lapsed: false, soon: false, daysLeft: 90, words: "90 days left" });
  assert.deepEqual(standing("2026-10-27", "2026-10-13"), { lapsed: false, soon: true, daysLeft: 14, words: "14 days left" });
  assert.equal(standing("2026-10-14", "2026-10-13").words, "1 day left");
  // It stands through its last day.
  assert.deepEqual(standing("2026-10-13", "2026-10-13"), { lapsed: false, soon: true, daysLeft: 0, words: "Lapses after today" });
  assert.deepEqual(standing("2026-10-12", "2026-10-13"), { lapsed: true, soon: false, daysLeft: -1, words: "Lapsed yesterday" });
  assert.equal(standing("2026-10-03", "2026-10-13").words, "Lapsed 10 days ago");
});

test("a link is labelled by where it goes", () => {
  assert.equal(linkLabel("https://www.example.com/clips/abc?x=1"), "example.com/clips/abc");
  assert.equal(linkLabel("https://example.com/"), "example.com");
  assert.equal(linkLabel(`https://example.com/${"a".repeat(80)}`).length, 48);
  assert.equal(linkLabel("not an address"), "not an address");
  // A long name that starts like a site you know is shown to its end, which is where it really goes.
  const long = "https://robertsspaceindustries.com.account-security-check.evil.example/sign-in/with/a/long/path";
  assert.match(linkLabel(long), /^robertsspaceindustries\.com\.account-security-check\.evil\.example\//);
  assert.equal(linkLabel("https://rsi.com@evil.example/x"), "evil.example/x");
});
