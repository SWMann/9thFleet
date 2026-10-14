// Training records: a lesson's form is read as it should be.

import assert from "node:assert/strict";
import { test } from "node:test";
import { progressWords, readLesson } from "./training-form";

test("a lesson needs a short name, a short description and a place in the list", () => {
  const read = (fields: Record<string, string>) => readLesson((name) => (fields[name] ?? "").replace(/\s+/g, " ").trim());
  assert.deepEqual(read({ name: " Radio  check ", description: "A check.", sort_order: "3" }), { fields: { name: "Radio check", description: "A check.", sort_order: 3 } });
  assert.match((read({ name: "", sort_order: "1" }) as { problem: string }).problem, /Give the lesson a name/);
  assert.match((read({ name: "x".repeat(81), sort_order: "1" }) as { problem: string }).problem, /under 80/);
  assert.match((read({ name: "Fine", description: "x".repeat(601), sort_order: "1" }) as { problem: string }).problem, /under 600/);
  assert.match((read({ name: "Fine", sort_order: "first" }) as { problem: string }).problem, /whole number/);
  assert.match((read({ name: "Fine", sort_order: "-1" }) as { problem: string }).problem, /whole number/);
});

test("progress is said in lessons", () => {
  assert.equal(progressWords(0, 1), "0 of 1 lesson");
  assert.equal(progressWords(3, 5), "3 of 5 lessons");
});
