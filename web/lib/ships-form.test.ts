// The ship register: the form is read as it should be.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readShip, readyWords, sinceWords } from "./ships-form";

const MODEL = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

test("a ship needs a model from the list, a short tidy name and a short note", () => {
  const read = (fields: Record<string, string>) => readShip((name) => (fields[name] ?? "").trim());
  assert.deepEqual(read({ model: MODEL, name: "Kestrel", ready: "on", note: "At Area18." }), { fields: { model_id: MODEL, name: "Kestrel", ready: true, note: "At Area18." } });
  assert.deepEqual(read({ model: MODEL }), { fields: { model_id: MODEL, name: "", ready: false, note: "" } });
  assert.match((read({ model: "gladius", name: "x" }) as { problem: string }).problem, /Choose the model/);
  assert.match((read({ model: MODEL, name: "x".repeat(61) }) as { problem: string }).problem, /under 60/);
  assert.match((read({ model: MODEL, name: `Hid${String.fromCharCode(0x200b)}den` }) as { problem: string }).problem, /hidden character/);
  assert.match((read({ model: MODEL, note: "x".repeat(601) }) as { problem: string }).problem, /under 600/);
});

test("readiness and time are said plainly", () => {
  assert.equal(readyWords(3, 5), "3 of 5 ready");
  const now = Date.parse("2026-10-15T12:00:00Z");
  assert.equal(sinceWords("2026-10-15T09:00:00Z", now), "today");
  assert.equal(sinceWords("2026-10-14T09:00:00Z", now), "yesterday");
  assert.equal(sinceWords("2026-10-05T09:00:00Z", now), "10 days ago");
  assert.equal(sinceWords("2026-09-01T09:00:00Z", now), "6 weeks ago");
  assert.equal(sinceWords("2026-06-01T09:00:00Z", now), "4 months ago");
});
